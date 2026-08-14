import { Effect } from 'effect';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDiscoveryCache } from './discovery.js';
import {
  BACKCHANNEL_LOGOUT_EVENT,
  clearJwksCache,
  makeZitadelOidc,
  type ZitadelOidcConfig,
  ZitadelOidcLayer,
  ZitadelOidcTag,
} from './oidc-client.js';

const ISSUER = 'https://idp.test';
const CLIENT_ID = 'client-1';

const config: ZitadelOidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  redirectUri: 'http://localhost:3001/api/auth/callback',
  postLogoutRedirectUri: 'http://localhost:3001/',
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
  /** What `/userinfo` answers; omit for an empty profile, `false` to fail it. */
  userInfo?: Record<string, unknown> | false;
}): void => {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes('/userinfo')) {
      if (tokenResponse.userInfo === false) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(tokenResponse.userInfo ?? {}),
      });
    }
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
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KEY_ID,
    alg: 'RS256',
  };
  foreignKey = (await generateKeyPair('RS256', { extractable: true }))
    .privateKey;
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
      await Effect.runPromise(
        makeZitadelOidc(config).authorizationUrl(AUTH_INPUT),
      ),
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
      await Effect.runPromise(
        makeZitadelOidc(config).authorizationUrl(AUTH_INPUT),
      ),
    );

    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
  });

  it('asks the hosted login for the locale the caller chose', async () => {
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(
        makeZitadelOidc(config).authorizationUrl({
          ...AUTH_INPUT,
          uiLocales: 'en',
        }),
      ),
    );

    expect(url.searchParams.get('ui_locales')).toBe('en');
  });

  it('omits ui_locales entirely when the caller states none', async () => {
    // Absent, not empty: a blank `ui_locales` is a language preference of ""
    // rather than "no preference", and the provider should be left to negotiate
    // from `Accept-Language` exactly as it did before the parameter existed.
    stubEndpoints({ body: {} });

    const url = new URL(
      await Effect.runPromise(
        makeZitadelOidc(config).authorizationUrl(AUTH_INPUT),
      ),
    );

    expect(url.searchParams.has('ui_locales')).toBe(false);
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

  it('carries the provider session id a later logout token will name', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      nonce: 'n',
      sid: 'zitadel-sid-1',
    });
    stubEndpoints({ body: { id_token: idToken } });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'c',
        codeVerifier: 'v',
        nonce: 'n',
      }),
    );

    expect(identity.providerSessionId).toBe('zitadel-sid-1');
  });

  it('ignores a sid userinfo supplies', async () => {
    // `sid` decides whose sessions a logout token revokes, so it may only come
    // from the document that was actually verified.
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      nonce: 'n',
    });
    stubEndpoints({
      body: { id_token: idToken, access_token: 'access-1' },
      userInfo: { sub: 'sub-1', sid: 'not-from-the-id-token' },
    });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'c',
        codeVerifier: 'v',
        nonce: 'n',
      }),
    );

    expect(identity.providerSessionId).toBeUndefined();
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

    const call = fetchMock.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('/token'),
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

    const jwksCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('/keys'),
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

/**
 * The provider ending a session it owns, which is the only way an r10c session
 * can be revoked from outside r10c. Everything here is about refusing tokens
 * that verify — a forged one is caught by the shared key check above.
 */
describe('verifyLogoutToken', () => {
  const signLogoutToken = (claims: Record<string, unknown>) =>
    signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
      ...claims,
    });

  it('reads the session and subject a logout token names', async () => {
    stubEndpoints({ body: {} });
    const token = await signLogoutToken({ sid: 'zitadel-sid-1', sub: 'sub-1' });

    const event = await Effect.runPromise(
      makeZitadelOidc(config).verifyLogoutToken(token),
    );

    expect(event).toEqual({
      providerSessionId: 'zitadel-sid-1',
      subject: 'sub-1',
    });
  });

  it('accepts a token naming only a subject', async () => {
    // The spec requires one of the two, not both, and providers differ.
    stubEndpoints({ body: {} });
    const token = await signLogoutToken({ sub: 'sub-1' });

    const event = await Effect.runPromise(
      makeZitadelOidc(config).verifyLogoutToken(token),
    );

    expect(event).toEqual({ providerSessionId: undefined, subject: 'sub-1' });
  });

  it('refuses an id_token replayed as a logout token', async () => {
    // It verifies perfectly: right key, right issuer, right audience. The nonce
    // is what gives it away, and it is the reason the two verifiers are separate.
    stubEndpoints({ body: {} });
    const token = await signLogoutToken({ sub: 'sub-1', nonce: 'nonce-1' });

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error.message).toContain('nonce');
  });

  it('refuses a token that declares no logout event', async () => {
    stubEndpoints({ body: {} });
    const token = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
    });

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error.message).toContain('back-channel logout event');
  });

  it('refuses a token whose events claim is not an object', async () => {
    stubEndpoints({ body: {} });
    const token = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      events: BACKCHANNEL_LOGOUT_EVENT,
    });

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error.message).toContain('back-channel logout event');
  });

  it('refuses a token whose events claim is null', async () => {
    stubEndpoints({ body: {} });
    const token = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      events: null,
    });

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error.message).toContain('back-channel logout event');
  });

  it('refuses a token that names neither a session nor a subject', async () => {
    // Nothing to revoke, and answering `ok` would hide that from the provider.
    stubEndpoints({ body: {} });
    const token = await signLogoutToken({});

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error.message).toContain('neither sid nor sub');
  });

  it('refuses a token signed by a key the issuer does not publish', async () => {
    stubEndpoints({ body: {} });
    const token = await signIdToken(
      {
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: 'attacker',
        events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
      },
      foreignKey,
    );

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error._tag).toBe('EntifixLogicError');
    expect(error.message).toContain('logout_token');
  });

  it('refuses a token minted for another client', async () => {
    stubEndpoints({ body: {} });
    const token = await signIdToken({
      iss: ISSUER,
      aud: 'someone-else',
      sub: 'sub-1',
      events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
    });

    const error = await Effect.runPromise(
      Effect.flip(makeZitadelOidc(config).verifyLogoutToken(token)),
    );

    expect(error._tag).toBe('EntifixLogicError');
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
      await Effect.runPromise(
        makeZitadelOidc(config).endSessionUrl('id-token'),
      ),
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

/**
 * The profile half of a sign-in, which is NOT in the id_token.
 *
 * Zitadel puts `email`, `email_verified` and `name` in userinfo unless the app
 * is configured to inline them, so a client that reads the id_token alone gets
 * a verified sign-in carrying no email and no display name — and the projection
 * silently writes nothing. That is the bug these cases exist to keep fixed.
 */
describe('the profile claims', () => {
  it('reads email and name from userinfo when the id_token omits them', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      nonce: 'nonce-1',
    });
    stubEndpoints({
      body: { id_token: idToken, access_token: 'access-1' },
      userInfo: {
        sub: 'sub-1',
        email: 'nora@example.com',
        email_verified: true,
        name: 'Nora Newcomer',
        preferred_username: 'nora@example.com',
      },
    });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
      }),
    );

    expect(identity.email).toBe('nora@example.com');
    expect(identity.emailVerified).toBe(true);
    expect(identity.displayName).toBe('Nora Newcomer');
  });

  // The id_token is the verified document. A userinfo response naming another
  // subject must not be able to point the sign-in at a different account.
  it('keeps the id_token subject when userinfo disagrees', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      nonce: 'nonce-1',
    });
    stubEndpoints({
      body: { id_token: idToken, access_token: 'access-1' },
      userInfo: { sub: 'somebody-else', email: 'nora@example.com' },
    });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
      }),
    );

    expect(identity.subject).toBe('sub-1');
  });

  // The id_token already proved who this is. A userinfo outage costs a stale
  // display name; it must never cost the sign-in.
  it('still signs in when userinfo fails', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      nonce: 'nonce-1',
    });
    stubEndpoints({
      body: { id_token: idToken, access_token: 'access-1' },
      userInfo: false,
    });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
      }),
    );

    expect(identity.subject).toBe('sub-1');
    expect(identity.email).toBeUndefined();
  });

  it('skips userinfo entirely when no access token came back', async () => {
    const idToken = await signIdToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'sub-1',
      nonce: 'nonce-1',
      email: 'from-id-token@example.com',
      email_verified: true,
    });
    stubEndpoints({ body: { id_token: idToken } });

    const identity = await Effect.runPromise(
      makeZitadelOidc(config).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        nonce: 'nonce-1',
      }),
    );

    expect(identity.email).toBe('from-id-token@example.com');
    expect(
      fetchMock.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes('/userinfo'),
      ),
    ).toBe(false);
  });
});
