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
 * The event a back-channel logout token must declare, from OpenID Connect
 * Back-Channel Logout 1.0 §2.4. A JWT that verifies but does not carry it is
 * some other token the provider issued, not a request to end a session.
 */
export const BACKCHANNEL_LOGOUT_EVENT =
  'http://schemas.openid.net/event/backchannel-logout';

/**
 * What the caller must have decided before a browser can be sent anywhere.
 *
 * The first three are minted by the caller rather than here, because all three
 * have to be *stored* before the redirect and read back after it — and where
 * they are stored (Redis, with a TTL and single-use semantics) is a composition
 * concern this client has no business knowing about.
 */
export interface AuthorizationUrlInput {
  /** CSRF handle; also the key the pending request is stored under. */
  readonly state: string;
  /** Binds the returned `id_token` to this request. */
  readonly nonce: string;
  /** The public half of the PKCE pair, from {@link createPkcePair}. */
  readonly codeChallenge: string;
  /**
   * Which language the hosted login should render in — a space-separated list
   * of BCP 47 tags, most preferred first, as `ui_locales` (OIDC Core §3.1.2.1).
   *
   * **Already validated by the caller.** This client has no opinion on which
   * locales exist: the fleet's list lives in `@r10c/entifix-ts-i18n`, and the
   * value arrives here from a browser cookie, so whoever reads that cookie is
   * the one that must check it against the list rather than echo it into a
   * redirect URL.
   *
   * Optional, and omitted from the URL when absent rather than defaulted: a
   * caller with no locale to state should leave the provider to negotiate from
   * `Accept-Language`, which is what it does with no parameter at all.
   */
  readonly uiLocales?: string;
}

/** Who Zitadel says signed in, reduced to what r10c projects onto its own record. */
export interface ZitadelIdentity {
  /** The stable `sub`. Recorded as an `external-subject` identifier, never as a key. */
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly preferredUsername?: string;
  readonly displayName?: string;
  /**
   * The provider's own session id (`sid`), when it issues one.
   *
   * It is what a back-channel logout token names, and our session id is our
   * own — so unless this is recorded against the session it opens, a logout at
   * the provider has nothing here to point at. Read from the **verified
   * id_token** only; a userinfo response must never be able to supply it.
   */
  readonly providerSessionId?: string;
  /** Needed to end the session at the provider; opaque to us otherwise. */
  readonly idToken: string;
}

/**
 * What a verified back-channel logout token asks for: end the session named by
 * `sid`, or every session belonging to `sub`. The spec requires at least one,
 * and providers differ on which they send.
 */
export interface LogoutEvent {
  readonly providerSessionId?: string;
  readonly subject?: string;
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
  endSessionUrl(idToken?: string): Effect.Effect<string, EntifixConnError>;
  /**
   * The other direction: the provider telling us a session it owns has ended.
   * Verifies the logout token and says which of our sessions it names.
   */
  verifyLogoutToken(
    logoutToken: string,
  ): Effect.Effect<LogoutEvent, EntifixConnError | EntifixLogicError>;
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
        if (input.uiLocales !== undefined) {
          url.searchParams.set('ui_locales', input.uiLocales);
        }
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

  /**
   * The security boundary of this file, and the only place either token kind is
   * verified. Without the pinned `algorithms` jose honours the token's own `alg`
   * header, and a JWKS key served openly would be accepted as an HMAC secret —
   * the same alg-confusion hole ADR 0015 closed on our own tokens. Written once
   * so a second verifier cannot be added without it.
   */
  const verifyProviderJwt = (
    discovery: OidcDiscovery,
    token: string,
    what: string,
  ) =>
    Effect.tryPromise({
      try: () =>
        jwtVerify(token, jwksFor(discovery), {
          algorithms: [ID_TOKEN_ALGORITHM],
          issuer: discovery.issuer,
          audience: config.clientId,
        }),
      catch: error =>
        new EntifixLogicError(`the ${what} did not verify: ${String(error)}`),
    });

  const verifyIdToken = (
    discovery: OidcDiscovery,
    idToken: string,
    nonce: string,
  ) =>
    verifyProviderJwt(discovery, idToken, 'id_token').pipe(
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

  /**
   * The profile claims, from the userinfo endpoint.
   *
   * They are fetched rather than read off the `id_token` because that is where
   * OIDC actually puts them: `email`, `email_verified` and `name` reach an
   * id_token only if the provider is configured to inline userinfo, and Zitadel
   * does not do that by default. Reading the id_token alone therefore produced a
   * verified sign-in with no email and no display name at all — the projection
   * had nothing to write, silently.
   *
   * Best-effort on purpose: the `id_token` is what proves *who* this is, and it
   * has already been verified by the time this runs. A userinfo outage should
   * cost a stale display name, never a sign-in.
   */
  const fetchUserInfo = (discovery: OidcDiscovery, accessToken?: string) =>
    accessToken === undefined
      ? Effect.succeed({} as JWTPayload)
      : Effect.tryPromise({
          try: async () => {
            const response = await fetch(discovery.userinfo_endpoint, {
              headers: { authorization: `Bearer ${accessToken}` },
            });
            if (!response.ok) {
              throw new Error(`userinfo answered ${String(response.status)}`);
            }
            return (await response.json()) as JWTPayload;
          },
          catch: error => new EntifixConnError(String(error)),
        }).pipe(Effect.catchAll(() => Effect.succeed({} as JWTPayload)));

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
                  Effect.flatMap(claims =>
                    fetchUserInfo(discovery, tokens.access_token).pipe(
                      // The id_token wins on `sub`: it is the verified one, and
                      // a userinfo response naming a different subject must not
                      // be able to redirect the sign-in to another account. Same
                      // for `sid`, which decides whose sessions a later logout
                      // token revokes.
                      Effect.map(profile =>
                        toIdentity(
                          {
                            ...profile,
                            ...claims,
                            sub: claims.sub,
                            sid: claims['sid'],
                          },
                          tokens.id_token as string,
                        ),
                      ),
                    ),
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

  /**
   * A logout token verifies exactly like an `id_token` — same key set, same
   * issuer, same audience — and then has to pass three checks that are the whole
   * difference between the two (OIDC Back-Channel Logout 1.0 §2.6).
   *
   * The `nonce` check is the load-bearing one, and it is why this cannot simply
   * reuse {@link verifyIdToken}: without it a stolen `id_token` POSTed to the
   * back-channel endpoint would verify perfectly and sign its owner out — or,
   * once this endpoint does anything less idempotent than a revoke, worse.
   */
  const verifyLogoutToken = (logoutToken: string) =>
    discover(config.issuer).pipe(
      Effect.flatMap(discovery =>
        verifyProviderJwt(discovery, logoutToken, 'logout_token'),
      ),
      Effect.flatMap(({ payload }) => {
        const events = payload['events'];
        if (
          typeof events !== 'object' ||
          events === null ||
          !(BACKCHANNEL_LOGOUT_EVENT in events)
        ) {
          return Effect.fail(
            new EntifixLogicError(
              'the logout_token does not declare a back-channel logout event',
            ),
          );
        }
        if (payload['nonce'] !== undefined) {
          return Effect.fail(
            new EntifixLogicError(
              'the logout_token carries a nonce, so it is an id_token replayed',
            ),
          );
        }
        const providerSessionId = asString(payload['sid']);
        const subject = asString(payload.sub);
        if (providerSessionId === undefined && subject === undefined) {
          return Effect.fail(
            new EntifixLogicError('the logout_token names neither sid nor sub'),
          );
        }
        return Effect.succeed({
          providerSessionId,
          subject,
        } satisfies LogoutEvent);
      }),
    );

  return { authorizationUrl, exchangeCode, endSessionUrl, verifyLogoutToken };
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
  providerSessionId: asString(claims['sid']),
  idToken,
});

/** Binds {@link ZitadelOidcTag} from a resolved configuration. */
export const ZitadelOidcLayer = (
  config: ZitadelOidcConfig,
): Layer.Layer<ZitadelOidcTag> =>
  Layer.succeed(ZitadelOidcTag, makeZitadelOidc(config));
