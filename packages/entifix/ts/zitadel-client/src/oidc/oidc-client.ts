import { EntifixConnError, EntifixLogicError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer } from 'effect';
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';

import { discover, type OidcDiscovery } from '../oidc/discovery';
import { CODE_CHALLENGE_METHOD } from '../oidc/pkce';

/** How this client is pointed at an instance. Resolved from config-service at boot. */
export interface ZitadelOidcConfig {
  /** e.g. `http://localhost:30080`. Must match the `iss` of every token issued. */
  readonly issuer: string;
  /** The public OIDC app's client id, created by `tools/zitadel-seed.mjs`. */
  readonly clientId: string;
  /** Where the hosted UI sends the browser back — an app origin, never a service. */
  readonly redirectUri: string;
  /** Where a completed sign-out lands. */
  readonly postLogoutRedirectUri: string;
  /**
   * Requested scopes. `openid` alone would authenticate without telling us who,
   * and the projection needs a verified email to key an account off.
   */
  readonly scopes?: readonly string[];
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email'] as const;

/** The one algorithm an `id_token` may be signed with. See {@link makeZitadelOidc}. */
export const ID_TOKEN_ALGORITHM = 'RS256';

/**
 * What the caller must have decided before a browser can be sent anywhere.
 *
 * All three are minted by the caller rather than here, because all three have
 * to be *stored* before the redirect and read back after it — and where they
 * are stored (Redis, with a TTL and single-use semantics) is a composition
 * concern this client has no business knowing about.
 */
export interface AuthorizationUrlInput {
  /** CSRF handle; also the key the pending request is stored under. */
  readonly state: string;
  /** Binds the returned `id_token` to this request. */
  readonly nonce: string;
  /** The public half of the PKCE pair, from {@link createPkcePair}. */
  readonly codeChallenge: string;
}

/** Who Zitadel says signed in, reduced to what r10c projects onto its own record. */
export interface ZitadelIdentity {
  /** The stable `sub`. Recorded as an `external-subject` identifier, never as a key. */
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly preferredUsername?: string;
  readonly displayName?: string;
  /** Needed to end the session at the provider; opaque to us otherwise. */
  readonly idToken: string;
}

export interface ZitadelOidc {
  /** Where to send the browser to begin a sign-in. */
  authorizationUrl(
    input: AuthorizationUrlInput,
  ): Effect.Effect<string, EntifixConnError>;
  /** Finish it: exchange the code, verify the `id_token`, and say who this is. */
  exchangeCode(input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly nonce: string;
  }): Effect.Effect<ZitadelIdentity, EntifixConnError | EntifixLogicError>;
  /** Where to send the browser so the provider's own session ends too. */
  endSessionUrl(
    idToken?: string,
  ): Effect.Effect<string, EntifixConnError>;
}

export class ZitadelOidcTag extends Context.Tag('ZitadelOidcTag')<
  ZitadelOidcTag,
  ZitadelOidc
>() {}

/**
 * JWKS is fetched lazily and cached per issuer, with jose handling rotation:
 * an unknown `kid` triggers one refetch rather than trusting the token.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Drop the memoised key sets. Exists for tests; nothing in production calls it. */
export const clearJwksCache = (): void => {
  jwksCache.clear();
};

const jwksFor = (discovery: OidcDiscovery) => {
  const cached = jwksCache.get(discovery.jwks_uri);
  if (cached !== undefined) return cached;
  const created = createRemoteJWKSet(new URL(discovery.jwks_uri));
  jwksCache.set(discovery.jwks_uri, created);
  return created;
};

interface TokenResponse {
  readonly id_token?: string;
  readonly access_token?: string;
}

/**
 * An OIDC client for a Zitadel instance, authorization-code + PKCE.
 *
 * The client is registered **public** (no secret), so the code exchange is
 * protected by PKCE alone. That is deliberate: a secret would be one more
 * credential to distribute through config-service and one more to leak, and it
 * would add nothing, because the exchange already proves possession of a
 * verifier that never left the server.
 */
export const makeZitadelOidc = (config: ZitadelOidcConfig): ZitadelOidc => {
  const scopes = (config.scopes ?? DEFAULT_SCOPES).join(' ');

  const authorizationUrl = (input: AuthorizationUrlInput) =>
    discover(config.issuer).pipe(
      Effect.map(discovery => {
        const url = new URL(discovery.authorization_endpoint);
        url.searchParams.set('client_id', config.clientId);
        url.searchParams.set('redirect_uri', config.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', scopes);
        url.searchParams.set('code_challenge', input.codeChallenge);
        url.searchParams.set('code_challenge_method', CODE_CHALLENGE_METHOD);
        url.searchParams.set('state', input.state);
        url.searchParams.set('nonce', input.nonce);
        return url.toString();
      }),
    );

  const requestTokens = (
    discovery: OidcDiscovery,
    code: string,
    codeVerifier: string,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(discovery.token_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.redirectUri,
            client_id: config.clientId,
            code_verifier: codeVerifier,
          }),
        });
        const payload = (await response.json()) as TokenResponse & {
          error?: string;
          error_description?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error_description ??
              payload.error ??
              `token endpoint answered ${String(response.status)}`,
          );
        }
        return payload;
      },
      catch: error =>
        new EntifixConnError(`the code exchange failed: ${String(error)}`),
    });

  const verifyIdToken = (
    discovery: OidcDiscovery,
    idToken: string,
    nonce: string,
  ) =>
    Effect.tryPromise({
      try: () =>
        jwtVerify(idToken, jwksFor(discovery), {
          // The security boundary of this file. Without it jose honours the
          // token's own `alg` header, and a JWKS key served openly would be
          // accepted as an HMAC secret — the same alg-confusion hole ADR 0015
          // closed on our own tokens.
          algorithms: [ID_TOKEN_ALGORITHM],
          issuer: discovery.issuer,
          audience: config.clientId,
        }),
      catch: error =>
        new EntifixLogicError(`the id_token did not verify: ${String(error)}`),
    }).pipe(
      Effect.flatMap(({ payload }) =>
        // Checked here rather than left to jose: a replayed `id_token` from an
        // older flow would otherwise verify perfectly.
        payload['nonce'] === nonce
          ? Effect.succeed(payload)
          : Effect.fail(
              new EntifixLogicError(
                'the id_token nonce does not match the authorization request',
              ),
            ),
      ),
    );

  const exchangeCode = (input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly nonce: string;
  }) =>
    discover(config.issuer).pipe(
      Effect.flatMap(discovery =>
        requestTokens(discovery, input.code, input.codeVerifier).pipe(
          Effect.flatMap(tokens =>
            tokens.id_token === undefined
              ? Effect.fail(
                  new EntifixLogicError(
                    'the token response carried no id_token',
                  ),
                )
              : verifyIdToken(discovery, tokens.id_token, input.nonce).pipe(
                  Effect.map(claims =>
                    toIdentity(claims, tokens.id_token as string),
                  ),
                ),
          ),
        ),
      ),
    );

  const endSessionUrl = (idToken?: string) =>
    discover(config.issuer).pipe(
      Effect.map(discovery => {
        const url = new URL(discovery.end_session_endpoint);
        url.searchParams.set(
          'post_logout_redirect_uri',
          config.postLogoutRedirectUri,
        );
        // Zitadel needs the hint to know *which* session to end; without it the
        // browser is asked to confirm, which turns sign-out into a dead end.
        if (idToken !== undefined) {
          url.searchParams.set('id_token_hint', idToken);
        }
        url.searchParams.set('client_id', config.clientId);
        return url.toString();
      }),
    );

  return { authorizationUrl, exchangeCode, endSessionUrl };
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const toIdentity = (claims: JWTPayload, idToken: string): ZitadelIdentity => ({
  subject: String(claims.sub),
  email: asString(claims['email']),
  // Absent means unproven. An unverified address must never be treated as one,
  // because linking on it is the classic account-takeover vector.
  emailVerified: claims['email_verified'] === true,
  preferredUsername: asString(claims['preferred_username']),
  displayName: asString(claims['name']),
  idToken,
});

/** Binds {@link ZitadelOidcTag} from a resolved configuration. */
export const ZitadelOidcLayer = (
  config: ZitadelOidcConfig,
): Layer.Layer<ZitadelOidcTag> =>
  Layer.succeed(ZitadelOidcTag, makeZitadelOidc(config));
