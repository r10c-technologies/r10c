import { Effect } from 'effect';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDiscoveryCache } from './discovery';
import {
  clearJwksCache,
  makeZitadelOidc,
  type ZitadelOidcConfig,
  ZitadelOidcLayer,
  ZitadelOidcTag,
} from './oidc-client';

const ISSUER = 'https://idp.test';
const CLIENT_ID = 'client-1';

const config: ZitadelOidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  redirectUri: 'http://localhost:3002/api/auth/callback',
  postLogoutRedirectUri: 'http://localhost:3002/',
};

const discoveryDocument = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/v2/authorize`,
  token_endpoint: `${ISSUER}/oauth/v2/token`,
  userinfo_endpoint: `${ISSUER}/oidc/v1/userinfo`,
  end_session_endpoint: `${ISSUER}/oidc/v1/end_session`,
  jwks_uri: `${ISSUER}/oauth/v2/keys`,
};

/** One signing key per suite run, plus a foreign one to prove forgery is refused. */
let signingKey: CryptoKey;
let publicJwk: JWK;
let foreignKey: CryptoKey;

const KEY_ID = 'test-key';

const signIdToken = async (
  claims: Record<string, unknown>,
  key: CryptoKey = signingKey,
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * One fetch double standing in for the three endpoints a sign-in touches:
 * discovery, JWKS and the token endpoint. `tokenResponse` is what the exchange
 * answers with, which is where each test's variation lives.
 */
const stubEndpoints = (tokenResponse: {
  ok?: boolean;
  body: unknown;
}): void => {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes('.well-known')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(discoveryDocument),
      });
    }
    if (url.includes('/keys')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ keys: [publicJwk] }),
      });
    }
    return Promise.resolve({
      ok: tokenResponse.ok ?? true,
      status: (tokenResponse.ok ?? true) ? 200 : 400,
      text: () => Promise.resolve(JSON.stringify(tokenResponse.body)),
      json: () => Promise.resolve(tokenResponse.body),
    });
  });
};

beforeEach(async () => {
  clearDiscoveryCache();
  clearJwksCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: 'RS256' };
  foreignKey = (await generateKeyPair('RS256', { extractable: true })).privateKey;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUTH_INPUT = {
  state: 'state-1',
  nonce: 'nonce-1',
  codeChallenge: 'challenge-1',
};

describe('authorizationUrl', () => {
  it('builds an authorization URL the hosted UI accepts', async () => {
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(makeZitadelOidc(config).authorizationUrl(AUTH_INPUT)),
    );

    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/v2/authorize`);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
  });

  it('carries the challenge the caller minted, and only that', async () => {
    // The verifier is the only thing standing between an intercepted code and a
    // token, so it must never appear anywhere the browser can read. This client
    // is never even told what it is.
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(makeZitadelOidc(config).authorizationUrl(AUTH_INPUT)),
    );

    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
  });

  it('honours configured scopes', async () => {
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(
        makeZitadelOidc({ ...config, scopes: ['openid'] }).authorizationUrl(
          AUTH_INPUT,
        ),
      ),
    );

    expect(url.searchParams.get('scope')).toBe('openid');
  });

  it('fails when the issuer is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).authorizationUrl(AUTH_INPUT)),
    );

    expect(error._tag).toBe('EntifixConnError');
  });
});

describe('exchangeCode', () => {
  it('returns the identity carried by a valid id_token', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'zitadel-sub-1',
      nonce: 'nonce-1',
      email: 'ada@example.com',
      email_verified: true,
      preferred_username: 'ada',
      name: 'Ada Lovelace',
    });
    stubEndpoints({ body: { id_token: idToken } });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
      }),
    );

    expect(identity).toEqual({
      subject: 'zitadel-sub-1',
      email: 'ada@example.com',
      emailVerified: true,
      preferredUsername: 'ada',
      displayName: 'Ada Lovelace',
      idToken,
    });
  });

  it('sends the verifier and no client secret', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub',
      nonce: 'n',
    });
    stubEndpoints({ body: { id_token: idToken } });

    await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'n',
      }),
    );

    const call = fetchMock.mock.calls.find(([url]: [unknown]) =>
      String(url).includes('/token'),
    );
    const body = String((call?.[1] as { body: URLSearchParams }).body);
    expect(body).toContain('code_verifier=verifier-1');
    expect(body).toContain('grant_type=authorization_code');
    // A public client has no secret to send; if one ever appears here it means
    // the app was re-registered as confidential and PKCE stopped being the
    // thing protecting the exchange.
    expect(body).not.toContain('client_secret');
  });

  it('reuses the key set across sign-ins', async () => {
    // jose refetches on an unknown `kid`, so caching costs nothing on rotation
    // and saves a JWKS round trip on every single sign-in.
    const claims = { iss: ISSUER, aud: CLIENT_ID, sub: 'sub', nonce: 'n' };
    stubEndpoints({ body: { id_token: await signIdToken(claims) } });
    const client = makeZitadelOidc(config);
    const exchange = () =>
      client.exchangeCode({ code: 'c', codeVerifier: 'v', nonce: 'n' });

    await Effect.runPromise(exchange());
    await Effect.runPromise(exchange());

    const jwksCalls = fetchMock.mock.calls.filter(([url]: [unknown]) =>
      String(url).includes('/keys'),
    );
    expect(jwksCalls).toHaveLength(1);
  });

  it('treats an unverified email as unverified', async () => {
    // Linking an account on an unproven address is the classic takeover vector,
    // so an absent claim must never be read as `true`.
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub',
      nonce: 'n',
      email: 'nobody@example.com',
    });
    stubEndpoints({ body: { id_token: idToken } });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'c',
        codeVerifier: 'v',
        nonce: 'n',
      }),
    );

    expect(identity.emailVerified).toBe(false);
    expect(identity.preferredUsername).toBeUndefined();
    expect(identity.displayName).toBeUndefined();
  });

  it('refuses a token signed by a key the issuer does not publish', async () => {
    const forged = await signIdToken(
      { iss: ISSUER, aud: CLIENT_ID, sub: 'attacker', nonce: 'n' },
      foreignKey,
    );
    stubEndpoints({ body: { id_token: forged } });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'n',
        }),
      ),
    );

    expect(error._tag).toBe('EntifixLogicError');
  });

  it('refuses a token minted for another client', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: 'someone-else',
      sub: 'sub',
      nonce: 'n',
    });
    stubEndpoints({ body: { id_token: idToken } });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'n',
        }),
      ),
    );

    expect(error._tag).toBe('EntifixLogicError');
  });

  it('refuses a replayed token from an older flow', async () => {
    // It verifies perfectly — right key, right issuer, right audience. The
    // nonce is the only thing that says it belongs to *this* sign-in.
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub',
      nonce: 'nonce-from-an-old-flow',
    });
    stubEndpoints({ body: { id_token: idToken } });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'the-current-one',
        }),
      ),
    );

    expect(error.message).toContain('nonce');
  });

  it('fails when the response carries no id_token', async () => {
    stubEndpoints({ body: { access_token: 'only-this' } });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'n',
        }),
      ),
    );

    expect(error.message).toContain('id_token');
  });

  it('surfaces the provider s own error description', async () => {
    stubEndpoints({
      ok: false,
      body: { error: 'invalid_grant', error_description: 'code expired' },
    });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'n',
        }),
      ),
    );

    expect(error.message).toContain('code expired');
  });

  it('falls back to the error code when there is no description', async () => {
    stubEndpoints({ ok: false, body: { error: 'invalid_request' } });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'n',
        }),
      ),
    );

    expect(error.message).toContain('invalid_request');
  });

  it('falls back to the status when the body says nothing', async () => {
    stubEndpoints({ ok: false, body: {} });

    const error = await Effect.runPromise(
      Effect.flip(
        makeZitadelOidc(config).exchangeCode({
          code: 'c',
          codeVerifier: 'v',
          nonce: 'n',
        }),
      ),
    );

    expect(error.message).toContain('400');
  });
});

describe('ZitadelOidcLayer', () => {
  it('binds the tag a composition root asks for', async () => {
    stubEndpoints({ body: {} });

    const url = await Effect.runPromise(
      Effect.gen(function* () {
        const oidc = yield* ZitadelOidcTag;
        return yield* oidc.authorizationUrl(AUTH_INPUT);
      }).pipe(Effect.provide(ZitadelOidcLayer(config))),
    );

    expect(url).toContain('code_challenge=challenge-1');
  });
});

describe('endSessionUrl', () => {
  it('sends the browser back to the app after signing out at the provider', async () => {
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(makeZitadelOidc(config).endSessionUrl('id-token')),
    );

    expect(url.origin + url.pathname).toBe(`${ISSUER}/oidc/v1/end_session`);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      config.postLogoutRedirectUri,
    );
    // Without the hint Zitadel asks the user which session to end, which turns
    // sign-out into a dead end rather than a redirect.
    expect(url.searchParams.get('id_token_hint')).toBe('id-token');
  });

  it('still builds a URL when no token is held', async () => {
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(makeZitadelOidc(config).endSessionUrl()),
    );

    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
  });
});
