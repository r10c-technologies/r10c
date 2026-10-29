import {
  type EntityApiContext,
  ExpiredToken,
  type OneTimeTokenStore,
  OneTimeTokenStoreTag,
  type RequestPrincipal,
  RequestPrincipalTag,
  type SessionData,
  type SessionRecord,
  type SessionStore,
  SessionStoreTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { Declined, NotFound, Unavailable } from '@entifix/core';
import {
  AccountRepositoryTag,
  DevMailboxTag,
  IdentityProviderTag,
  IdTokenStoreTag,
  makeSessionIdentityProvider,
  NotificationPortTag,
  type OidcProvider,
  OidcProviderTag,
  ProviderDirectoryTag,
  ProviderEventVerifierTag,
  type ProviderIdentity,
  ProviderSessionIndexTag,
  PublicKeySetTag,
  SessionScopeResolverTag,
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
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { authFlowEndpoints } from './flow-api.js';
import { bodyOf, readDevice } from './request-body.js';
import { DevSurfaceEnabledTag, sessionEndpoints } from './session-api.js';
import { userIdentityApi, userSessionEndpoints } from './user-api.js';

const [
  jwks,
  oidcStart,
  oidcCallback,
  logout,
  backChannelLogout,
  providerEvents,
  refresh,
  resolveSession,
] = authFlowEndpoints;
const [mySessions, revokeMySession, myDevices, devOutbox] = sessionEndpoints;
const [userSessions] = userSessionEndpoints;
const [updateAspects, revokeSessions, signOutOthers] =
  userIdentityApi.options.useCases;
const createUser = userIdentityApi.options.override.create.handler;

/** Sessions held in memory, each answered as entifix's store answers it. */
const makeSessions = () => {
  const records = new Map<string, SessionRecord>();
  let next = 0;
  const store: SessionStore = {
    create: (data: SessionData) =>
      Effect.sync(() => {
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
      records.has(sessionId)
        ? Effect.succeed(records.get(sessionId) as SessionRecord)
        : Effect.fail(new NotFound({})),
    touch: sessionId =>
      records.has(sessionId) ? Effect.void : Effect.fail(new NotFound({})),
    listForUser: userId =>
      Effect.sync(() =>
        Array.from(records.values()).filter(
          record => String(record.userId) === String(userId),
        ),
      ),
    revoke: sessionId => Effect.sync(() => void records.delete(sessionId)),
    revokeAllForUser: userId =>
      Effect.sync(() => {
        for (const [id, record] of Array.from(records)) {
          if (String(record.userId) === String(userId)) records.delete(id);
        }
      }),
    revokeAllForUserExcept: (userId, keep) =>
      Effect.sync(() => {
        for (const [id, record] of Array.from(records)) {
          if (String(record.userId) === String(userId) && id !== keep) {
            records.delete(id);
          }
        }
      }),
  };
  return { store, records };
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
        : Effect.fail(new NotFound({})),
  };
};

const identity = (
  fields: Partial<ProviderIdentity> = {},
): ProviderIdentity => ({
  subject: 'sub-ada',
  email: 'ada@example.com',
  emailVerified: true,
  displayName: 'Ada Lovelace',
  idToken: 'id-token-ada',
  providerSessionId: 'sid-1',
  ...fields,
});

const world = (
  options: {
    readonly devSurface?: boolean;
    readonly provider?: (scripted: OidcProvider) => OidcProvider;
    readonly devices?: UserDeviceRepository;
  } = {},
) => {
  const sessions = makeSessions();
  const accounts = makeInMemoryAccountRepository();
  const notices = makeInMemoryNotificationPort();
  const events = makeInMemoryProviderEvents();
  const scripted = makeScriptedOidcProvider({
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
  const layer = Layer.mergeAll(
    Layer.succeed(SessionStoreTag, sessions.store),
    Layer.succeed(OneTimeTokenStoreTag, makeOneTimeTokens()),
    Layer.succeed(TokenServiceTag, {
      sign: (claims: TokenClaims) =>
        Effect.succeed(`token-${claims.sessionId}`),
      verify: () => Effect.die('unused'),
    }),
    Layer.succeed(AccountRepositoryTag, accounts),
    Layer.succeed(
      UserDeviceRepositoryTag,
      options.devices ?? makeInMemoryUserDeviceRepository(),
    ),
    Layer.succeed(NotificationPortTag, notices.port),
    Layer.succeed(DevMailboxTag, notices.mailbox),
    Layer.succeed(
      SessionScopeResolverTag,
      makeInMemorySessionScopeResolver({
        individuals: [],
        memberships: [],
        roles: [],
        entitlements: [],
      }),
    ),
    Layer.succeed(IdTokenStoreTag, makeInMemoryIdTokenStore()),
    Layer.succeed(ProviderSessionIndexTag, makeInMemoryProviderSessionIndex()),
    Layer.succeed(
      OidcProviderTag,
      options.provider === undefined ? scripted : options.provider(scripted),
    ),
    Layer.succeed(ProviderEventVerifierTag, events.verifier),
    Layer.succeed(ProviderDirectoryTag, makeInMemoryProviderDirectory()),
    Layer.succeed(PublicKeySetTag, makeStaticPublicKeySet()),
    Layer.succeed(
      IdentityProviderTag,
      makeSessionIdentityProvider(sessions.store, accounts),
    ),
    Layer.succeed(DevSurfaceEnabledTag, options.devSurface ?? true),
  );
  // Every handler's requirements are in the layer; the cast drops the union.
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      Effect.result(Effect.provide(effect, layer as never)) as Effect.Effect<
        unknown,
        never,
        never
      >,
    );

  /** Start and finish a sign-in for `code`. */
  const signIn = async (code: string, extra: Record<string, unknown> = {}) => {
    const started = await run(
      oidcStart.handler({ payload: { redirect: '/after', uiLocale: 'es' } }),
    );
    const url = (started as { success: { authorizationUrl: string } }).success
      .authorizationUrl;
    const state = new URL(url).searchParams.get('state') as string;
    return run(
      oidcCallback.handler({ payload: { code, state, ...extra } }) as never,
    );
  };
  return { run, signIn, sessions, accounts, notices, events };
};

const as =
  (principal: Partial<RequestPrincipal> & { userId: string }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, RequestPrincipalTag, {
      subject: principal.userId,
      sessionId: 'none',
      roles: [],
      attributes: {},
      ...principal,
    } as RequestPrincipal);

const context = (principal: Partial<RequestPrincipal>): EntityApiContext => ({
  principal: {
    userId: 'admin-1',
    subject: 'admin-1',
    sessionId: 's-admin',
    roles: ['super-admin'],
    attributes: {},
    ...principal,
  } as RequestPrincipal,
  links: { record: () => [], collection: () => [] },
});

const success = (result: unknown) =>
  (result as { _tag: string; success: Record<string, unknown> }).success;
const failure = (result: unknown) =>
  (result as { _tag: string; failure: Record<string, unknown> }).failure;

describe('the request body helpers', () => {
  it('read a record, and a device only when it names itself', () => {
    expect(bodyOf('text')).toEqual({});
    expect(readDevice({})).toBeUndefined();
    expect(readDevice({ device: 'phone' })).toBeUndefined();
    expect(readDevice({ device: { browser: 'Firefox' } })).toBeUndefined();
    expect(readDevice({ device: { deviceId: 'd-1', os: 'Linux' } })).toEqual({
      deviceId: 'd-1',
      browser: undefined,
      os: 'Linux',
      type: undefined,
      ip: undefined,
    });
  });
});

describe('the sign-in flow', () => {
  it('publishes the public key set', async () => {
    const { run } = world();

    expect(success(await run(jwks.handler({} as never)))).toHaveProperty(
      'keys',
    );
  });

  it('starts with a state, and drops a locale the fleet does not speak', async () => {
    const { run } = world();

    const spoken = success(
      await run(oidcStart.handler({ payload: { uiLocale: 'es' } })),
    );
    const unknown = success(
      await run(oidcStart.handler({ payload: { uiLocale: 'xx' } })),
    );

    expect(String(spoken['authorizationUrl'])).toContain('ui_locales=es');
    expect(String(unknown['authorizationUrl'])).not.toContain('ui_locales');
  });

  it('finishes a sign-in into a session, the redirect it asked for, and the provider link', async () => {
    const { run, signIn, notices } = world();

    const first = success(
      await signIn('code-ada', { device: { deviceId: 'd-1' } }),
    );
    await signIn('code-ada', { device: { deviceId: 'd-1' } });
    await signIn('code-plain');
    await signIn('code-anon', { device: { deviceId: 'd-9' } });

    expect(first).toMatchObject({ redirect: '/after', expiresIn: 900 });
    // Announced on first sight only, and never to an account with no address.
    const delivered = success(
      await run(notices.mailbox.read(undefined)),
    ) as unknown as readonly { kind: string }[];
    expect(
      delivered.filter(notice => notice.kind === 'new-device'),
    ).toHaveLength(1);
  });

  it('refuses a callback without a code, a spent state, and a code nobody issued', async () => {
    const { run, signIn } = world();

    expect(
      failure(await run(oidcCallback.handler({ payload: {} }) as never)),
    ).toMatchObject({ code: 'invalidRequest' });
    expect(
      failure(
        await run(
          oidcCallback.handler({
            payload: { code: 'code-ada', state: 'never' },
          }) as never,
        ),
      ),
    ).toMatchObject({ code: 'invalidState' });
    expect(failure(await signIn('code-forged'))).toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('a sign-in the provider or a label store refuses', () => {
  it('answers a code the provider declines, or a token that expired, as unauthenticated', async () => {
    const refusing = (failure: Declined | ExpiredToken) =>
      world({
        provider: scripted => ({
          ...scripted,
          exchangeCode: () => Effect.fail(failure),
        }),
      }).signIn('code-ada');

    expect(
      failure(await refusing(new Declined({ reason: 'no' }))),
    ).toMatchObject({ code: 'unauthenticated' });
    expect(failure(await refusing(new ExpiredToken()))).toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('signs in even when the device history cannot be written', async () => {
    const { signIn } = world({
      devices: {
        ...makeInMemoryUserDeviceRepository(),
        remember: () => Effect.fail(new Unavailable({})),
      },
    });

    expect(
      success(await signIn('code-ada', { device: { deviceId: 'd-1' } })),
    ).toHaveProperty('accessToken');
  });
});

describe('signing out', () => {
  it('revokes the session and answers where the provider ends its own', async () => {
    const { run, signIn, sessions } = world();
    const { sessionId } = success(await signIn('code-ada')) as {
      sessionId: string;
    };

    const out = success(await run(logout.handler({ payload: { sessionId } })));
    const anonymous = success(await run(logout.handler({ payload: {} })));

    expect(out['endSessionUrl']).toContain('id_token_hint=id-token-ada');
    expect(anonymous).toMatchObject({ ok: true });
    expect(sessions.records.has(sessionId)).toBe(false);
  });

  it('answers ok when the provider cannot be reached, since the local session is gone', async () => {
    const { run } = world({
      provider: scripted => ({
        ...scripted,
        endSessionUrl: () => Effect.fail(new Unavailable({})),
      }),
    });

    expect(success(await run(logout.handler({ payload: {} })))).toEqual({
      ok: true,
    });
  });
});

describe('the provider ending a session or a user', () => {
  it('revokes what a logout token names, by sid or else by subject', async () => {
    const { run, signIn, sessions } = world();
    await signIn('code-ada');
    const linked = await run(
      backChannelLogout.handler({ payload: { logout_token: 'logout-sid' } }),
    );
    await signIn('code-ada');
    const bySubject = await run(
      backChannelLogout.handler({
        payload: { logout_token: 'logout-unlinked' },
      }),
    );

    expect(success(linked)).toEqual({ ok: true });
    expect(success(bySubject)).toEqual({ ok: true });
    expect(sessions.records.size).toBe(0);
  });

  it('answers ok for a token naming nothing it knows, and refuses one that does not verify', async () => {
    const { run } = world();
    const call = (token: string) =>
      run(backChannelLogout.handler({ payload: { logout_token: token } }));

    expect(success(await call('logout-stranger'))).toEqual({ ok: true });
    expect(success(await call('logout-empty'))).toEqual({ ok: true });
    expect(failure(await call('forged'))).toMatchObject({
      code: 'invalidRequest',
    });
  });

  it('revokes a user’s sessions on a signed event, and refuses an unsigned one', async () => {
    const { run, signIn, sessions, events } = world();
    await signIn('code-ada');
    const event = (subject: string, ends: boolean) => {
      const raw = events.eventFor(subject, ends);
      return providerEvents.handler({
        payload: raw,
        headers: events.sign(raw) as Record<string, string>,
      });
    };

    const ignored = await run(event('sub-ada', false));
    expect(sessions.records.size).toBe(1);
    const unknown = await run(event('sub-nobody', true));
    const ended = await run(event('sub-ada', true));
    const forged = await run(
      providerEvents.handler({
        payload: events.eventFor('sub-ada', true),
        headers: {},
      }),
    );

    expect([ignored, unknown, ended].map(success)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(sessions.records.size).toBe(0);
    expect(failure(forged)).toMatchObject({ code: 'unauthenticated' });
  });
});

describe('a live session', () => {
  it('refreshes into a fresh token, and refuses one that is gone or unnamed', async () => {
    const { run, signIn } = world();
    const { sessionId } = success(await signIn('code-ada')) as {
      sessionId: string;
    };

    const fresh = success(
      await run(refresh.handler({ payload: { sessionId } })),
    );
    const gone = failure(
      await run(refresh.handler({ payload: { sessionId: 'gone' } })),
    );
    const unnamed = failure(await run(refresh.handler({ payload: {} })));

    expect(fresh).toMatchObject({ accessToken: `token-${sessionId}` });
    expect(gone).toMatchObject({ code: 'sessionExpired' });
    expect(unnamed).toMatchObject({ code: 'invalidRequest' });
  });

  it('resolves to its principal, and refuses an unknown one', async () => {
    const { run, signIn } = world();
    const { sessionId } = success(await signIn('code-ada')) as {
      sessionId: string;
    };

    expect(
      success(await run(resolveSession.handler({ params: { sessionId } }))),
    ).toMatchObject({ sessionId });
    expect(
      failure(
        await run(resolveSession.handler({ params: { sessionId: 'nope' } })),
      ),
    ).toMatchObject({ code: 'sessionUnresolved' });
  });
});

describe('a user’s own sessions and devices', () => {
  it('lists them, ends one, and answers somebody else’s as absent', async () => {
    const { run, signIn } = world();
    const signedIn = success(
      await signIn('code-ada', { device: { deviceId: 'd-1' } }),
    ) as { sessionId: string; principal: { userId: string } };
    const mine = as({
      userId: signedIn.principal.userId,
      sessionId: signedIn.sessionId,
    });

    const listed = success(await run(mine(mySessions.handler({} as never))));
    const devices = success(await run(mine(myDevices.handler({} as never))));
    const stranger = failure(
      await run(
        as({ userId: 'someone-else' })(
          revokeMySession.handler({
            params: { sessionId: signedIn.sessionId },
          }),
        ),
      ),
    );
    const ended = success(
      await run(
        mine(
          revokeMySession.handler({
            params: { sessionId: signedIn.sessionId },
          }),
        ),
      ),
    );

    expect(listed['items']).toEqual([
      expect.objectContaining({ sessionId: signedIn.sessionId, current: true }),
    ]);
    expect((devices['items'] as unknown[]).length).toBe(1);
    expect(stranger).toMatchObject({ code: 'notFound' });
    expect(ended).toEqual({ ok: true, signedOut: true });
  });

  it('reads the development outbox only while the surface is on', async () => {
    const on = world();
    await on.signIn('code-ada', { device: { deviceId: 'd-1' } });
    const off = world({ devSurface: false });

    const read = success(
      await on.run(devOutbox.handler({ query: { to: 'ada@example.com' } })),
    );
    const hidden = failure(await off.run(devOutbox.handler({ query: {} })));

    expect((read['items'] as unknown[]).length).toBe(1);
    expect(hidden).toMatchObject({ code: 'notFound' });
  });
});

describe('administering accounts', () => {
  const create = (body: unknown, roles = ['super-admin']) =>
    createUser({ payload: body }, context({ roles }));

  it('creates an account and the provider’s human for it', async () => {
    const { run } = world();

    const created = success(
      await run(
        create({
          displayName: 'Grace',
          role: 'admin',
          identifiers: [
            { type: 'email', value: 'grace@example.com' },
            { type: 'username', value: 'grace' },
            { type: 'email' },
          ],
        }),
      ),
    );
    const plain = success(
      await run(
        create({ identifiers: [{ type: 'email', value: 'plain@x.com' }] }),
      ),
    );

    expect(created).toHaveProperty('userId');
    expect(plain).toHaveProperty('userId');
  });

  it('refuses no identifier, an unknown role and no email', async () => {
    const { run } = world();

    expect(failure(await run(create({})))).toMatchObject({
      code: 'identifierRequired',
    });
    expect(
      failure(
        await run(
          create({
            role: 'emperor',
            identifiers: [{ type: 'email', value: 'e@x.com' }],
          }),
        ),
      ),
    ).toMatchObject({ code: 'unknownRole' });
    expect(
      failure(
        await run(
          create({ identifiers: [{ type: 'username', value: 'nomail' }] }),
        ),
      ),
    ).toMatchObject({ code: 'emailRequired' });
  });

  it('changes a user’s role and ends their sessions, and refuses an unknown status', async () => {
    const { run, signIn, sessions } = world();
    const { principal } = success(await signIn('code-ada')) as {
      principal: { userId: string };
    };
    const update = (payload: unknown) =>
      updateAspects.handler(
        { params: { id: principal.userId }, payload },
        context({}),
      );

    const updated = success(await run(update({ role: 'admin' })));
    const unknown = failure(await run(update({ status: 'asleep' })));
    const reactivated = success(await run(update({ status: 'active' })));

    expect(updated['role']).toBe('admin');
    expect(reactivated['status']).toBe('active');
    expect(unknown).toMatchObject({ code: 'unknownStatus' });
    expect(sessions.records.size).toBe(0);
  });

  it('reads and ends another user’s sessions, and lets a user sign out the rest of their own', async () => {
    const { run, signIn, sessions } = world();
    const first = success(await signIn('code-ada')) as {
      sessionId: string;
      principal: { userId: string };
    };
    const second = success(await signIn('code-ada')) as { sessionId: string };
    const userId = first.principal.userId;

    const listed = success(
      await run(
        as({ userId: 'admin-1' })(
          userSessions.handler({ params: { id: userId } }),
        ),
      ),
    );
    await run(
      signOutOthers.handler(
        {},
        context({ userId, sessionId: second.sessionId }),
      ),
    );
    expect(Array.from(sessions.records.keys())).toEqual([second.sessionId]);
    const revoked = success(
      await run(revokeSessions.handler({ params: { id: userId } })),
    );

    expect((listed['items'] as unknown[]).length).toBe(2);
    expect(revoked).toEqual({ ok: true });
    expect(sessions.records.size).toBe(0);
  });
});
