import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  type DeviceContext,
  EntityRepositoryFactoryTag,
  type OneTimeTokenStore,
  OneTimeTokenStoreTag,
  type SessionData,
  type SessionRecord,
  type SessionStore,
  SessionStoreTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  type AccountRepository,
  AccountRepositoryTag,
  AuthnError,
  DevMailboxTag,
  ForbiddenError,
  IdentityProviderTag,
  IdTokenStoreTag,
  makeSessionIdentityProvider,
  NotificationPortTag,
  OidcProviderTag,
  type ProviderDirectory,
  ProviderDirectoryTag,
  ProviderEventVerifierTag,
  type ProviderIdentity,
  ProviderSessionIndexTag,
  PublicKeySetTag,
  SessionScopeResolverTag,
  UnauthenticatedError,
  type UserDeviceRepository,
  UserDeviceRepositoryTag,
} from '@r10c/business-ts-authn';
import {
  makeInMemoryAccountRepository,
  makeInMemoryIdTokenStore,
  makeInMemoryNotificationPort,
  makeInMemoryProviderDirectory,
  makeInMemoryProviderEvents,
  makeInMemoryProviderSessionIndex,
  makeInMemorySessionScopeResolver,
  makeInMemoryUserDeviceRepository,
  makeScriptedOidcProvider,
  makeStaticPublicKeySet,
} from '@r10c/business-ts-authn/testing';
import { ROLE_PERMISSIONS } from '@r10c/business-ts-authz-grants';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readDevice,
  respondAuthError,
} from './auth-responses.js';
import { authnRoutes } from './authn-routes.js';
import { DevSurfaceEnabledTag } from './session-routes.js';

// #region doubles of entifix's own session ports

/** Sessions held in memory, with a switch that fails every call. */
const makeSessions = () => {
  const records = new Map<string, SessionRecord>();
  let next = 0;
  const state = { down: false };
  const guard = <A>(run: () => A) =>
    state.down
      ? Effect.fail(new EntifixConnError('session store down'))
      : Effect.sync(run);
  const store: SessionStore = {
    create: (data: SessionData) =>
      guard(() => {
        next += 1;
        const sessionId = `s-${String(next)}`;
        records.set(sessionId, {
          ...data,
          sessionId,
          createdAt: new Date(Date.now() + next).toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          absoluteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
        return sessionId;
      }),
    read: sessionId =>
      state.down || !records.has(sessionId)
        ? Effect.fail(new EntifixConnError('no such session'))
        : Effect.succeed(records.get(sessionId) as SessionRecord),
    touch: () => guard(() => undefined),
    listForUser: userId =>
      guard(() =>
        Array.from(records.values()).filter(
          record => String(record.userId) === String(userId),
        ),
      ),
    revoke: sessionId => guard(() => void records.delete(sessionId)),
    revokeAllForUser: userId =>
      guard(() => {
        for (const [id, record] of Array.from(records)) {
          if (String(record.userId) === String(userId)) records.delete(id);
        }
      }),
    revokeAllForUserExcept: (userId, keep) =>
      guard(() => {
        for (const [id, record] of Array.from(records)) {
          if (String(record.userId) === String(userId) && id !== keep) {
            records.delete(id);
          }
        }
      }),
  };
  return { store, records, state };
};

/** One-time tokens held in memory: each is consumed once. */
const makeOneTimeTokens = (): OneTimeTokenStore => {
  const tokens = new Map<string, string>();
  let next = 0;
  return {
    issue: (purpose, subject) =>
      Effect.sync(() => {
        next += 1;
        const token = `${purpose}-${String(next)}`;
        tokens.set(token, subject);
        return token;
      }),
    consume: (_purpose, token) =>
      tokens.has(token)
        ? Effect.sync(() => {
            const subject = tokens.get(token) as string;
            tokens.delete(token);
            return subject;
          })
        : Effect.fail(new EntifixConnError('unknown token')),
  };
};

// #endregion

/** A provider identity the scripted provider answers for `code-…`. */
const identity = (fields: Partial<ProviderIdentity> = {}): ProviderIdentity => ({
  subject: 'sub-ada',
  email: 'ada@example.com',
  emailVerified: true,
  displayName: 'Ada Lovelace',
  idToken: 'id-token-ada',
  providerSessionId: 'sid-1',
  ...fields,
});

interface WorldOptions {
  readonly accounts?: AccountRepository;
  readonly devices?: UserDeviceRepository;
  readonly directory?: ProviderDirectory;
  readonly devSurface?: boolean;
  readonly publicKeys?: 'failing';
  readonly mailbox?: 'failing';
}

const served: ServedRoutes[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map(one => one.dispose()));
});

const world = (options: WorldOptions = {}) => {
  const sessions = makeSessions();
  const accounts = options.accounts ?? makeInMemoryAccountRepository();
  const notices = makeInMemoryNotificationPort();
  const events = makeInMemoryProviderEvents();
  const idTokens = makeInMemoryIdTokenStore();
  const providerSessions = makeInMemoryProviderSessionIndex();
  const provider = makeScriptedOidcProvider({
    identities: {
      'code-ada': identity(),
      'code-plain': identity({
        subject: 'sub-plain',
        email: 'plain@example.com',
        providerSessionId: undefined,
      }),
      'code-anon': identity({
        subject: 'sub-anon',
        email: undefined,
        emailVerified: false,
        providerSessionId: undefined,
      }),
    },
    logouts: {
      'logout-sid': { providerSessionId: 'sid-1' },
      'logout-unlinked': { providerSessionId: 'sid-9', subject: 'sub-ada' },
      'logout-stranger': { subject: 'sub-nobody' },
      'logout-empty': {},
    },
  });
  const claims = new Map<string, TokenClaims>();

  const routes = serveRoutes(
    authnRoutes,
    Layer.mergeAll(
      Layer.succeed(SessionStoreTag, sessions.store),
      Layer.succeed(OneTimeTokenStoreTag, makeOneTimeTokens()),
      Layer.succeed(TokenServiceTag, {
        sign: (signed: TokenClaims) =>
          Effect.sync(() => {
            const token = `token-${signed.sessionId}`;
            claims.set(token, signed);
            return token;
          }),
        verify: (token: string) =>
          claims.has(token)
            ? Effect.succeed(claims.get(token) as TokenClaims)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision(ROLE_PERMISSIONS),
      ),
      Layer.succeed(AccountRepositoryTag, accounts),
      Layer.succeed(
        UserDeviceRepositoryTag,
        options.devices ?? makeInMemoryUserDeviceRepository(),
      ),
      Layer.succeed(NotificationPortTag, notices.port),
      Layer.succeed(
        DevMailboxTag,
        options.mailbox === 'failing'
          ? { read: () => Effect.fail(new EntifixConnError('mailbox down')) }
          : notices.mailbox,
      ),
      Layer.succeed(
        SessionScopeResolverTag,
        makeInMemorySessionScopeResolver({
          individuals: [],
          memberships: [],
          roles: [],
          entitlements: [],
        }),
      ),
      Layer.succeed(IdTokenStoreTag, idTokens),
      Layer.succeed(ProviderSessionIndexTag, providerSessions),
      Layer.succeed(OidcProviderTag, provider),
      Layer.succeed(ProviderEventVerifierTag, events.verifier),
      Layer.succeed(
        ProviderDirectoryTag,
        options.directory ?? makeInMemoryProviderDirectory(),
      ),
      Layer.succeed(
        PublicKeySetTag,
        options.publicKeys === 'failing'
          ? { jwks: () => Effect.fail(new EntifixConnError('no key')) }
          : makeStaticPublicKeySet(),
      ),
      Layer.succeed(
        IdentityProviderTag,
        makeSessionIdentityProvider(sessions.store, accounts),
      ),
      Layer.succeed(DevSurfaceEnabledTag, options.devSurface ?? true),
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () => Effect.succeed(makeInMemoryEntityRepository()),
      }),
    ),
  );
  served.push(routes);

  const json = (method: string, path: string, body?: unknown, token?: string) =>
    routes.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** A session minted as the token service would sign it, for `roles`. */
  const sessionFor = async (userId: string, roles: string[]) => {
    const sessionId = await Effect.runPromise(
      sessions.store.create(
        { userId, subject: userId, roles, attributes: {} },
        { idleTtlSeconds: 60, absoluteTtlSeconds: 60 },
      ),
    );
    const token = `token-${sessionId}`;
    claims.set(token, { userId, subject: userId, sessionId, roles });
    return { sessionId, token };
  };

  /** Starts and finishes a sign-in for `code`, answering the callback. */
  const signIn = async (code: string, extra: Record<string, unknown> = {}) => {
    const started = (await (
      await json('POST', '/api/auth/oidc/start', { redirect: '/after' })
    ).json()) as { authorizationUrl: string };
    const state = new URL(started.authorizationUrl).searchParams.get(
      'state',
    ) as string;
    return json('POST', '/api/auth/oidc/callback', { code, state, ...extra });
  };

  return {
    routes,
    json,
    sessions,
    accounts,
    notices,
    events,
    idTokens,
    providerSessions,
    sessionFor,
    signIn,
  };
};

const bodyOf = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

describe('respondAuthError', () => {
  const ERRORS: readonly unknown[] = [
    new UnauthenticatedError('no', 'accountInactive'),
    { _tag: 'UnauthenticatedError' },
    new ForbiddenError('not yours', 'cannotAssignRole'),
    { _tag: 'ForbiddenError' },
    new AuthnError('taken', 'identifierTaken'),
    { _tag: 'AuthnError' },
    new EntifixBuildError('bad'),
    new Error('boom'),
  ];
  const answering = serveRoutes(
    HttpRouter.addAll([
      HttpRouter.route(
        'GET',
        '/error/:index',
        Effect.flatMap(HttpRouter.params, params =>
          respondAuthError(
            ERRORS[Number(params.index)] as { _tag?: string },
          ),
        ),
      ),
    ]),
    Layer.empty,
  );
  served.push(answering);

  it('answers each authn failure with its status and its own code, or the default', async () => {
    const cases = await Promise.all(
      ERRORS.map(async (_error, index) => {
        const response = await answering.call(`/error/${String(index)}`);
        return { status: response.status, body: await bodyOf(response) };
      }),
    );

    expect(cases.map(one => [one.status, one.body['code']])).toEqual([
      [401, 'accountInactive'],
      [401, 'invalidCredentials'],
      [403, 'cannotAssignRole'],
      [403, 'forbidden'],
      [409, 'identifierTaken'],
      [409, 'invalidRequest'],
      [400, 'invalidRequest'],
      [500, 'unexpected'],
    ]);
    expect(cases[3]?.body['error']).toBe('forbidden');
    expect(cases[5]?.body['error']).toBe('request refused');
  });
});

describe('readDevice', () => {
  it('reads a device only when it names one', () => {
    expect(readDevice({})).toBeUndefined();
    expect(readDevice({ device: { browser: 'x' } })).toBeUndefined();
    expect(readDevice({ device: { deviceId: 'd-1', browser: 7 } })).toEqual({
      deviceId: 'd-1',
      browser: undefined,
      os: undefined,
      type: undefined,
      ip: undefined,
    });
  });
});

describe('GET /.well-known/jwks.json', () => {
  it('publishes the key set, and answers 500 when it cannot', async () => {
    const ok = await world().json('GET', '/.well-known/jwks.json');
    const broken = await world({ publicKeys: 'failing' }).json(
      'GET',
      '/.well-known/jwks.json',
    );

    expect(await bodyOf(ok)).toMatchObject({ keys: [{ kid: 'test-key' }] });
    expect(broken.status).toBe(500);
  });
});

describe('POST /api/auth/oidc/start', () => {
  it('sends the browser to the provider with a known locale, and drops an unknown one', async () => {
    const w = world();

    const known = await bodyOf(
      await w.json('POST', '/api/auth/oidc/start', { uiLocale: 'es' }),
    );
    const unknown = await bodyOf(
      await w.json('POST', '/api/auth/oidc/start', { uiLocale: 'es-GT' }),
    );

    const params = (body: Record<string, unknown>) =>
      new URL(body['authorizationUrl'] as string).searchParams;
    expect(params(known).get('ui_locales')).toBe('es');
    expect(params(unknown).has('ui_locales')).toBe(false);
    expect(params(known).get('code_challenge_method')).toBe('S256');
  });

  it('reads a JSON null body as an empty one', async () => {
    const response = await world().routes.call('/api/auth/oidc/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    expect(response.status).toBe(200);
  });

  it('answers a body that is not JSON as an unexpected failure', async () => {
    const response = await world().routes.call('/api/auth/oidc/start', {
      method: 'POST',
      body: 'not json',
    });

    expect(response.status).toBe(500);
  });
});

describe('POST /api/auth/oidc/callback', () => {
  it('opens a session, remembers the id token and links the provider session', async () => {
    const w = world();

    const response = await w.signIn('code-ada', {
      device: { deviceId: 'd-1', browser: 'Firefox', os: 'Linux', ip: '1.2.3.4' },
    });
    const body = await bodyOf(response);
    const sessionId = body['sessionId'] as string;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ redirect: '/after', expiresIn: 900 });
    expect(await Effect.runPromise(w.idTokens.take(sessionId))).toBe(
      'id-token-ada',
    );
    expect(
      await Effect.runPromise(w.providerSessions.take('sid-1')),
    ).toEqual([sessionId]);
    expect(
      (await Effect.runPromise(w.notices.mailbox.read('ada@example.com')))[0],
    ).toMatchObject({
      kind: 'new-device',
      data: { browser: 'Firefox', os: 'Linux', ip: '1.2.3.4' },
    });
  });

  it('announces a device once, labelling what it does not know', async () => {
    const w = world();
    const device = { device: { deviceId: 'd-1' } };

    await w.signIn('code-ada', device);
    await w.signIn('code-ada', device);

    const ada = await Effect.runPromise(
      w.notices.mailbox.read('ada@example.com'),
    );
    expect(ada).toHaveLength(1);
    expect(ada[0]?.data).toEqual({
      browser: 'unknown',
      os: 'unknown',
      ip: 'unknown',
    });
  });

  it('signs in with no provider session to link, and despite a device history that cannot remember', async () => {
    const devices = makeInMemoryUserDeviceRepository();
    const w = world({
      devices: {
        ...devices,
        remember: () => Effect.fail(new EntifixConnError('down')),
      },
    });

    const response = await w.signIn('code-plain', {
      device: { deviceId: 'd-1' },
    });

    expect(response.status).toBe(200);
    expect(await Effect.runPromise(w.providerSessions.take('sid-1'))).toEqual(
      [],
    );
  });

  it('announces a new device to nobody for an account with no address', async () => {
    const w = world();

    const response = await w.signIn('code-anon', {
      device: { deviceId: 'd-1' },
    });

    expect(response.status).toBe(200);
    expect(
      await Effect.runPromise(w.notices.mailbox.read(undefined)),
    ).toEqual([]);
  });

  it('refuses a callback missing its code, a spent state, and a code the provider never issued', async () => {
    const w = world();
    const started = (await (
      await w.json('POST', '/api/auth/oidc/start', {})
    ).json()) as { authorizationUrl: string };
    const state = new URL(started.authorizationUrl).searchParams.get('state');

    const missing = await w.json('POST', '/api/auth/oidc/callback', {
      state,
    });
    const forged = await w.json('POST', '/api/auth/oidc/callback', {
      code: 'never',
      state,
    });
    const spent = await w.json('POST', '/api/auth/oidc/callback', {
      code: 'code-ada',
      state,
    });

    expect(missing.status).toBe(400);
    expect(forged.status).toBe(500);
    expect(spent.status).toBe(401);
    expect(await bodyOf(spent)).toMatchObject({ code: 'invalidState' });
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and ends the provider session by its id token', async () => {
    const w = world();
    const { sessionId } = (await bodyOf(await w.signIn('code-ada'))) as {
      sessionId: string;
    };

    const body = await bodyOf(
      await w.json('POST', '/api/auth/logout', { sessionId }),
    );

    expect(
      new URL(body['endSessionUrl'] as string).searchParams.get(
        'id_token_hint',
      ),
    ).toBe('id-token-ada');
    expect(w.sessions.records.has(sessionId)).toBe(false);
  });

  it('ends a provider session with no hint, and still answers ok when the store fails', async () => {
    const w = world();

    const bare = await bodyOf(await w.json('POST', '/api/auth/logout', {}));
    w.sessions.state.down = true;
    const failed = await w.json('POST', '/api/auth/logout', {
      sessionId: 's-1',
    });

    expect(bare['endSessionUrl']).toEqual(expect.any(String));
    expect(await bodyOf(failed)).toEqual({ ok: true });
  });
});

describe('POST /api/auth/backchannel-logout', () => {
  const logout = (w: ReturnType<typeof world>, token?: string) =>
    w.routes.call('/api/auth/backchannel-logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: token === undefined ? '' : `logout_token=${token}`,
    });

  it('revokes every session the provider session is linked to', async () => {
    const w = world();
    const { sessionId } = (await bodyOf(await w.signIn('code-ada'))) as {
      sessionId: string;
    };

    const response = await logout(w, 'logout-sid');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(w.sessions.records.has(sessionId)).toBe(false);
  });

  it('falls back to the subject when the provider session links nothing', async () => {
    const w = world();
    const { sessionId } = (await bodyOf(await w.signIn('code-plain'))) as {
      sessionId: string;
    };
    await w.signIn('code-ada');

    await logout(w, 'logout-unlinked');

    expect(w.sessions.records.size).toBe(1);
    expect(w.sessions.records.has(sessionId)).toBe(true);
  });

  it('answers 200 for a subject it does not know, and for a token naming nothing', async () => {
    const w = world();

    expect((await logout(w, 'logout-stranger')).status).toBe(200);
    expect((await logout(w, 'logout-empty')).status).toBe(200);
  });

  it('answers 400 for no token and for one that does not verify', async () => {
    const w = world();

    expect((await logout(w)).status).toBe(400);
    expect((await logout(w, 'forged')).status).toBe(400);
  });
});

describe('POST /api/auth/provider-events', () => {
  const send = (w: ReturnType<typeof world>, subject: string, ends: boolean) => {
    const body = w.events.eventFor(subject, ends);
    return w.routes.call('/api/auth/provider-events', {
      method: 'POST',
      headers: { ...w.events.sign(body) } as Record<string, string>,
      body,
    });
  };

  it('ends every session of a user the provider deactivated', async () => {
    const w = world();
    await w.signIn('code-ada');

    const response = await send(w, 'sub-ada', true);

    expect(response.status).toBe(200);
    expect(w.sessions.records.size).toBe(0);
  });

  it('acts on nothing for an unknown subject or an event that ends nothing', async () => {
    const w = world();
    await w.signIn('code-ada');

    await send(w, 'sub-nobody', true);
    await send(w, 'sub-ada', false);

    expect(w.sessions.records.size).toBe(1);
  });

  it('answers 400 for an event that does not verify', async () => {
    const response = await world().routes.call('/api/auth/provider-events', {
      method: 'POST',
      body: '{"subject":"sub-ada","endsSessions":true}',
    });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('re-signs every claim from the session record', async () => {
    const w = world();
    const { sessionId } = await w.sessionFor('u-1', ['user']);

    const body = await bodyOf(
      await w.json('POST', '/api/auth/refresh', { sessionId }),
    );

    expect(body).toMatchObject({
      accessToken: `token-${sessionId}`,
      expiresIn: 900,
      principal: { userId: 'u-1', sessionId },
    });
    expect(body['sessionExpiresIn']).toBeGreaterThan(0);
  });

  it('counts a session past its ceiling as expiring now', async () => {
    const w = world();
    const { sessionId } = await w.sessionFor('u-1', ['user']);
    const record = w.sessions.records.get(sessionId) as SessionRecord;
    w.sessions.records.set(sessionId, {
      ...record,
      absoluteExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const body = await bodyOf(
      await w.json('POST', '/api/auth/refresh', { sessionId }),
    );

    expect(body['sessionExpiresIn']).toBe(0);
  });

  it('answers 400 for no session id, and 401 for a session that is gone', async () => {
    const w = world();

    expect((await w.json('POST', '/api/auth/refresh', {})).status).toBe(400);
    expect(
      (await w.json('POST', '/api/auth/refresh', { sessionId: 'gone' }))
        .status,
    ).toBe(401);
  });
});

describe('GET /api/auth/session/:sessionId', () => {
  it('resolves a live session, and answers 401 for one that is not', async () => {
    const w = world();
    const { sessionId } = await w.sessionFor('u-1', ['user']);

    const live = await w.json('GET', `/api/auth/session/${sessionId}`);
    const gone = await w.json('GET', '/api/auth/session/gone');

    expect(await bodyOf(live)).toMatchObject({ userId: 'u-1', sessionId });
    expect(gone.status).toBe(401);
  });
});

describe('the caller’s own sessions', () => {
  it('lists them newest first, marking the current one and its device', async () => {
    const w = world();
    const first = await w.sessionFor('u-1', ['user']);
    await Effect.runPromise(
      w.sessions.store.create(
        {
          userId: 'u-1',
          subject: 'u-1',
          roles: [],
          attributes: {},
          device: { deviceId: 'd-1' } as DeviceContext,
        },
        { idleTtlSeconds: 1, absoluteTtlSeconds: 1 },
      ),
    );

    const body = (await bodyOf(
      await w.json('GET', '/api/auth/sessions', undefined, first.token),
    )) as { items: { current: boolean; device: unknown }[] };

    expect(body.items.map(item => [item.current, item.device])).toEqual([
      [false, { deviceId: 'd-1' }],
      [true, null],
    ]);
  });

  it('answers 500 when the store fails to list them', async () => {
    const w = world();
    const { token } = await w.sessionFor('u-1', ['user']);
    w.sessions.state.down = true;

    expect(
      (await w.json('GET', '/api/auth/sessions', undefined, token)).status,
    ).toBe(500);
  });

  it('ends one of them, says when it was the current one, and hides anyone else’s', async () => {
    const w = world();
    const mine = await w.sessionFor('u-1', ['user']);
    const other = await w.sessionFor('u-1', ['user']);
    const theirs = await w.sessionFor('u-2', ['user']);

    const ended = await bodyOf(
      await w.json(
        'DELETE',
        `/api/auth/sessions/${other.sessionId}`,
        undefined,
        mine.token,
      ),
    );
    const foreign = await w.json(
      'DELETE',
      `/api/auth/sessions/${theirs.sessionId}`,
      undefined,
      mine.token,
    );
    const unknown = await w.json(
      'DELETE',
      '/api/auth/sessions/gone',
      undefined,
      mine.token,
    );
    const self = await bodyOf(
      await w.json(
        'DELETE',
        `/api/auth/sessions/${mine.sessionId}`,
        undefined,
        mine.token,
      ),
    );

    expect(ended).toEqual({ ok: true, signedOut: false });
    expect(self).toEqual({ ok: true, signedOut: true });
    expect([foreign.status, unknown.status]).toEqual([404, 404]);
  });

  it('ends all the others, and answers 500 when the store fails', async () => {
    const w = world();
    const mine = await w.sessionFor('u-1', ['user']);
    await w.sessionFor('u-1', ['user']);

    const ended = await w.json(
      'POST',
      '/api/auth/sessions/revoke-others',
      undefined,
      mine.token,
    );
    expect(ended.status).toBe(200);
    expect(w.sessions.records.size).toBe(1);

    w.sessions.records.clear();
    const again = await w.sessionFor('u-1', ['user']);
    w.sessions.state.down = true;
    expect(
      (
        await w.json(
          'POST',
          '/api/auth/sessions/revoke-others',
          undefined,
          again.token,
        )
      ).status,
    ).toBe(500);
  });

  it('lists the caller’s devices, and answers 500 when they cannot be read', async () => {
    const devices = makeInMemoryUserDeviceRepository();
    await Effect.runPromise(
      devices.remember('u-1', { deviceId: 'd-1', browser: 'Firefox' }),
    );
    const w = world({ devices });
    const { token } = await w.sessionFor('u-1', ['user']);
    const broken = world({
      devices: { ...devices, listForUser: () => Effect.die('bad record') },
    });
    const other = await broken.sessionFor('u-1', ['user']);

    const listed = (await bodyOf(
      await w.json('GET', '/api/auth/devices', undefined, token),
    )) as { items: { deviceId: string }[] };

    expect(listed.items.map(item => item.deviceId)).toEqual(['d-1']);
    expect(
      (await broken.json('GET', '/api/auth/devices', undefined, other.token))
        .status,
    ).toBe(500);
  });
});

describe('GET /api/dev/outbox', () => {
  it('reads what was sent, to one address or all, and 404s outside development', async () => {
    const w = world();
    await Effect.runPromise(
      w.notices.port.send({ kind: 'new-device', userId: 'u', to: 'a@x' }),
    );

    const one = (await bodyOf(
      await w.json('GET', '/api/dev/outbox?to=a%40x'),
    )) as { items: unknown[] };
    const all = (await bodyOf(await w.json('GET', '/api/dev/outbox'))) as {
      items: unknown[];
    };
    const hidden = await world({ devSurface: false }).json(
      'GET',
      '/api/dev/outbox',
    );
    const broken = await world({ mailbox: 'failing' }).json(
      'GET',
      '/api/dev/outbox',
    );

    expect([one.items.length, all.items.length]).toEqual([1, 1]);
    expect(hidden.status).toBe(404);
    expect(broken.status).toBe(500);
  });
});

describe('administering accounts', () => {
  const create = (w: ReturnType<typeof world>, token: string, body: unknown) =>
    w.json('POST', '/api/user-identity', body, token);
  const adaBody = {
    displayName: 'Ada Lovelace',
    identifiers: [
      { type: 'email', value: 'ada@example.com' },
      { type: 'username', value: 'ada' },
    ],
  };

  it('creates the account and its provider human together', async () => {
    const w = world();
    const { token } = await w.sessionFor('root', ['super-admin']);

    const response = await create(w, token, { ...adaBody, role: 'admin' });
    const subject = await bodyOf(response);

    expect(response.status).toBe(201);
    expect(
      await Effect.runPromise(w.accounts.findByIdentifier('provider-1')),
    ).toMatchObject({ id: subject['userId'] });
  });

  it('refuses no identifier, an unknown role, no address, a taken identifier, and a provider that is down', async () => {
    const w = world();
    const { token } = await w.sessionFor('root', ['super-admin']);
    await create(w, token, adaBody);
    const down = world({
      directory: {
        name: 'down',
        findUserIdByEmail: () => Effect.fail(new EntifixConnError('down')),
        createHuman: () => Effect.die('unused'),
      },
    });
    const downToken = (await down.sessionFor('root', ['super-admin'])).token;

    const answers = await Promise.all([
      create(w, token, { identifiers: [] }),
      create(w, token, { identifiers: 'ada@example.com' }),
      create(w, token, { ...adaBody, role: 'emperor' }),
      create(w, token, { identifiers: [{ type: 'username', value: 'x' }] }),
      create(w, token, adaBody),
      create(down, downToken, adaBody),
    ]);

    expect(
      await Promise.all(
        answers.map(async answer => [
          answer.status,
          (await bodyOf(answer))['code'],
        ]),
      ),
    ).toEqual([
      [400, 'invalidRequest'],
      [400, 'invalidRequest'],
      [400, 'unknownRole'],
      [400, 'emailRequired'],
      [409, expect.any(String)],
      [409, 'providerUnavailable'],
    ]);
  });

  it('refuses a caller without the grant', async () => {
    const w = world();
    const { token } = await w.sessionFor('u-1', ['user']);

    expect((await create(w, token, adaBody)).status).toBe(403);
  });

  it('changes a role and a status, revoking the user’s sessions', async () => {
    const w = world();
    const { token } = await w.sessionFor('root', ['super-admin']);
    const created = await bodyOf(await create(w, token, adaBody));
    const userId = created['userId'] as string;
    await w.sessionFor(userId, ['user']);

    const response = await w.json(
      'PATCH',
      `/api/user-identity/${userId}`,
      { role: 'admin', status: 'suspended' },
      token,
    );

    expect(await bodyOf(response)).toMatchObject({
      role: 'admin',
      status: 'suspended',
    });
    expect(
      Array.from(w.sessions.records.values()).some(
        record => String(record.userId) === userId,
      ),
    ).toBe(false);
  });

  it('refuses an unknown role, an unknown status, and an unknown user', async () => {
    const w = world();
    const { token } = await w.sessionFor('root', ['super-admin']);

    const statuses = await Promise.all(
      [{ role: 'emperor' }, { status: 'asleep' }, { role: 'admin' }].map(
        async body =>
          (await w.json('PATCH', '/api/user-identity/nobody', body, token))
            .status,
      ),
    );

    expect(statuses).toEqual([400, 400, 409]);
  });

  it('lists and ends a user’s sessions, and answers 500 when the store fails', async () => {
    const w = world();
    const { token } = await w.sessionFor('root', ['super-admin']);
    await w.sessionFor('u-9', ['user']);

    const listed = (await bodyOf(
      await w.json('GET', '/api/user-identity/u-9/sessions', undefined, token),
    )) as { items: unknown[] };
    const ended = await w.json(
      'DELETE',
      '/api/user-identity/u-9/sessions',
      undefined,
      token,
    );
    w.sessions.state.down = true;
    const failures = await Promise.all([
      w.json('GET', '/api/user-identity/u-9/sessions', undefined, token),
      w.json('DELETE', '/api/user-identity/u-9/sessions', undefined, token),
    ]);

    expect(listed.items).toHaveLength(1);
    expect(ended.status).toBe(200);
    expect(failures.map(failure => failure.status)).toEqual([500, 500]);
  });

  it('serves the canonical records behind their own permission', async () => {
    const w = world();
    const { token } = await w.sessionFor('root', ['super-admin']);

    expect(
      (await w.json('GET', '/api/user-identity', undefined, token)).status,
    ).toBe(200);
    expect(
      (await w.json('GET', '/api/entity-identifier', undefined, token)).status,
    ).toBe(200);
  });
});
