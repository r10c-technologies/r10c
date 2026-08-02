import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  AccountRepositoryTag,
  AttemptLimiterTag,
  type AuthSubject,
  ChangePasswordInputTag,
  changePasswordUCFactory,
  EntityIdentifier,
  type IdentifierType,
  LockedError,
  LoginInputTag,
  loginUCFactory,
  NotificationKind,
  NotificationPortTag,
  type Principal,
  RegisterInputTag,
  registerUserUCFactory,
  RequestPasswordResetInputTag,
  requestPasswordResetUCFactory,
  ResetPasswordInputTag,
  resetPasswordUCFactory,
  resolveSessionUCFactory,
  SessionIdTag,
  UpdateUserAspectsInputTag,
  updateUserAspectsUCFactory,
  UserDevice,
  UserDeviceRepositoryTag,
  UserIdentity,
  UserStatus,
} from '@r10c/business-ts-authn';
import {
  isRole,
  permissionForEntity,
  type Role,
} from '@r10c/business-ts-authz';
import {
  type DeviceContext,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
  type SessionRecord,
  SessionStoreTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import {
  EntifixBuildError,
  Entity,
  EntityConstructor,
  EntityLoadRequest,
  extractMetaEntity,
  serializeEntity,
  serializeEntityCollection,
} from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  redactConfiguration,
  requirePermission,
  requirePrincipal,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { ActiveOrganizationResolverTag } from './identity/active-organization';
import { describeIdentityModel } from './identity/identity-showcase';
import { readOutbox } from './identity/notifications';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_SESSION_LIFETIME,
  SESSION_IDLE_TTL_SECONDS,
} from './identity/session-policy';

/** Reads `page`/`pageSize` from the request query string. */
const readLoadRequest = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const search = new URL(req.url, 'http://localhost').searchParams;
  return {
    page: Number(search.get('page')) || 1,
    pageSize: Number(search.get('pageSize')) || 10,
  } satisfies EntityLoadRequest;
});

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/** Generic list route backed by Mongo + the entifix load UC. */
const listRoute = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const request = yield* readLoadRequest;
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityLoadRequestTag, request),
    );
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(entityConstructor, page.items),
      total: page.total,
      request: page.request,
    });
  }).pipe(Effect.catchAll(serverError));

/** Generic single-record route by `:id`. */
const byIdRoute = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;
    const entity = yield* getUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityIdTag, params.id),
    );
    return yield* HttpServerResponse.json(
      serializeEntity(entityConstructor, entity),
    );
  }).pipe(
    // The entity's own key, not a hardcoded English name passed at the call
    // site: the client translates `errors:notFound` and already knows how to
    // render that entity's label from its metadata.
    Effect.catchAll(() =>
      HttpServerResponse.json(
        {
          message: 'not found',
          code: 'notFound',
          entity: extractMetaEntity(entityConstructor).key,
        },
        { status: 404 },
      ),
    ),
  );

/** `GET /api/config` — this service's loaded parameters (credentials redacted). */
const configIntrospectionRoute = Effect.gen(function* () {
  const plain = yield* LoadedConfigurationTag;
  return yield* HttpServerResponse.json({
    service: '@r10c/auth-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});

// #region auth flow

/** The JSON an authenticated flow returns; the Next app turns it into cookies. */
interface AuthResult {
  readonly accessToken: string;
  readonly sessionId: string;
  /** Seconds the ACCESS TOKEN is valid for — not the session. */
  readonly expiresIn: number;
  /**
   * Seconds until the session's absolute ceiling. The app sizes its cookies
   * against this rather than {@link AuthResult.expiresIn}: a cookie that dies
   * with the token makes an expired token indistinguishable from no session at
   * all, which is what used to sign everyone out every fifteen minutes.
   */
  readonly sessionExpiresIn: number;
  readonly principal: Principal;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Read the JSON request body as a record. */
const readBody = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* req.json;
  return (body ?? {}) as Record<string, unknown>;
});

/**
 * Map an authn failure to a status without leaking the cause.
 *
 * Every body carries a `code` — a key in the shared `errors` catalog — beside
 * the English `error`. The client renders the code; `error` stays for logs and
 * for any consumer that has not been taught the vocabulary. This used to send
 * the domain's own `message` as the response body, so a Spanish user read
 * "not allowed to assign that role".
 */
const respondAuthError = (error: { _tag?: string }) => {
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message;

  switch (error._tag) {
    case 'UnauthenticatedError':
      return HttpServerResponse.json(
        { error: 'invalid credentials', code: code ?? 'invalidCredentials' },
        { status: 401 },
      );
    // Authenticated, but not permitted — the opposite of a 401, and not a
    // conflict either. Which rule refused is safe to say: knowing it reveals
    // nothing the caller could not infer.
    case 'ForbiddenError':
      return HttpServerResponse.json(
        { error: message ?? 'forbidden', code: code ?? 'forbidden' },
        { status: 403 },
      );
    case 'AuthnError':
      return HttpServerResponse.json(
        { error: message ?? 'request refused', code: code ?? 'invalidRequest' },
        { status: 409 },
      );
    // Too many failures. `429` rather than `423 Locked`: the condition is a
    // rate, it clears on its own, and every client already understands it.
    case 'LockedError':
      return HttpServerResponse.json(
        {
          error: message ?? 'too many attempts',
          code: code ?? 'accountLocked',
        },
        { status: 429 },
      );
    case 'EntifixBuildError':
      return HttpServerResponse.json(
        { error: 'invalid request', code: 'invalidRequest' },
        { status: 400 },
      );
    default:
      return HttpServerResponse.json(
        { error: 'authentication failed', code: 'unexpected' },
        { status: 500 },
      );
  }
};

/** Read the optional device struct the `-app` edge parsed for us. */
const readDevice = (
  body: Record<string, unknown>,
): DeviceContext | undefined => {
  const raw = body['device'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  const deviceId = asString(entry['deviceId']);
  if (deviceId === undefined) return undefined;
  return {
    deviceId,
    browser: asString(entry['browser']),
    os: asString(entry['os']),
    type: asString(entry['type']),
    ip: asString(entry['ip']),
  };
};

/**
 * Turn a credential-verified {@link AuthSubject} into a live session + access
 * token. The session lands in Redis (revocation handle); the token carries only
 * the small, stable claims a downstream authorization check needs.
 *
 * The device rides on the session for display, and is separately remembered in
 * Mongo so "have I seen this browser before?" survives the session expiring. It
 * is a label throughout: nothing here consults it to decide anything.
 */
const establishSession = (
  subject: AuthSubject,
  device?: DeviceContext,
): Effect.Effect<
  AuthResult,
  never,
  | AccountRepositoryTag
  | ActiveOrganizationResolverTag
  | NotificationPortTag
  | SessionStoreTag
  | TokenServiceTag
  | UserDeviceRepositoryTag
> =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const tokens = yield* TokenServiceTag;

    if (device !== undefined) {
      const devices = yield* UserDeviceRepositoryTag;
      const notifications = yield* NotificationPortTag;
      const accounts = yield* AccountRepositoryTag;
      // Best-effort throughout: neither a device-history write nor a
      // notification may cost someone their sign-in. They are labels and
      // warnings; the session is the thing that matters.
      yield* devices.remember(subject.userId, device).pipe(
        Effect.flatMap(remembered =>
          // Only on FIRST sight. Announcing a familiar browser every time is
          // how a security alert becomes noise the owner filters out.
          remembered.isNew
            ? accounts.findContactAddress(subject.userId).pipe(
                Effect.flatMap(to =>
                  // No contact address means nowhere to send it — a
                  // username-only account is not an error.
                  to === null
                    ? Effect.void
                    : notifications.send({
                        kind: NotificationKind.NewDevice,
                        userId: subject.userId,
                        to,
                        data: {
                          browser: device.browser ?? 'unknown',
                          os: device.os ?? 'unknown',
                          ip: device.ip ?? 'unknown',
                        },
                      }),
                ),
              )
            : Effect.void,
        ),
        Effect.catchAll(() => Effect.void),
      );
    }

    // Which organization this session acts for. Resolved once, at sign-in, and
    // then carried by the session — so `requirePrincipal` stays stateless and
    // no service re-reads a membership on the hot path. `undefined` is a normal
    // answer: a buyer or an operator holds no tenant scope.
    const organizations = yield* ActiveOrganizationResolverTag;
    const activeOrganizationId = yield* organizations.forUser(
      String(subject.userId),
    );

    const sessionId = yield* sessions.create(
      { ...subject, activeOrganizationId, device },
      DEFAULT_SESSION_LIFETIME,
    );
    const accessToken = yield* tokens.sign(
      {
        userId: subject.userId,
        subject: subject.subject,
        sessionId,
        roles: subject.roles,
        activeOrganizationId,
      },
      ACCESS_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      sessionId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionExpiresIn: DEFAULT_SESSION_LIFETIME.absoluteTtlSeconds,
      principal: {
        ...subject,
        organizationId: activeOrganizationId,
        sessionId,
      },
    };
  }).pipe(Effect.orDie);

/** Parse a registration body into the use-case input, or fail 400. */
const parseRegister = (body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const password = asString(body['password']);
    const rawIdentifiers = Array.isArray(body['identifiers'])
      ? body['identifiers']
      : [];
    const identifiers = rawIdentifiers
      .map(entry => entry as Record<string, unknown>)
      .map(entry => ({
        type: asString(entry['type']) as IdentifierType | undefined,
        value: asString(entry['value']),
      }))
      .filter(
        (entry): entry is { type: IdentifierType; value: string } =>
          entry.type !== undefined && entry.value !== undefined,
      );

    if (password === undefined || identifiers.length === 0) {
      return yield* Effect.fail(
        new EntifixBuildError(
          'registration requires a password and identifier',
        ),
      );
    }

    return {
      displayName: asString(body['displayName']),
      identifiers,
      password,
    };
  });

/** `POST /api/auth/register` — provision an account and log it straight in. */
const registerRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const input = yield* parseRegister(body);
  const subject = yield* registerUserUCFactory().pipe(
    Effect.provideService(RegisterInputTag, input),
  );
  const result = yield* establishSession(subject, readDevice(body));
  return yield* HttpServerResponse.json(result, { status: 201 });
}).pipe(Effect.catchAll(respondAuthError));

/**
 * `POST /api/auth/login` — verify credentials and open a session.
 *
 * Wrapped in the attempt limiter. The check runs BEFORE credentials are looked
 * at, so a locked identifier costs an attacker nothing to discover and, more to
 * the point, costs the server no bcrypt work per attempt.
 */
const loginRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const identifier = asString(body['identifier']);
  const password = asString(body['password']);
  if (identifier === undefined || password === undefined) {
    return yield* HttpServerResponse.json(
      { error: 'invalid request', code: 'invalidRequest' },
      { status: 400 },
    );
  }

  const limiter = yield* AttemptLimiterTag;
  // The device id where we have one: steadier than an IP, which a phone rotates
  // several times a day, and it keeps one household behind a NAT from locking
  // each other out.
  const device = readDevice(body);
  const source = device?.deviceId ?? device?.ip ?? 'unknown';

  const standing = yield* limiter.check(identifier, source);
  if (standing.locked) {
    return yield* respondAuthError(
      new LockedError('too many attempts', 'accountLocked', undefined, {
        retryAfterSeconds: standing.retryAfterSeconds,
      }),
    );
  }

  const subject = yield* loginUCFactory().pipe(
    Effect.provideService(LoginInputTag, { identifier, password }),
    Effect.tapError(() => onFailedAttempt(identifier, source)),
  );

  yield* limiter.succeed(identifier, source);
  const result = yield* establishSession(subject, device);
  return yield* HttpServerResponse.json(result, { status: 200 });
}).pipe(Effect.catchAll(respondAuthError));

/**
 * Count a failed sign-in, and tell the owner if this is the attempt that locked
 * them out — once, on the transition, so a sustained attack does not mail them
 * per attempt.
 */
const onFailedAttempt = (identifier: string, source: string) =>
  Effect.gen(function* () {
    const limiter = yield* AttemptLimiterTag;
    const state = yield* limiter.fail(identifier, source);
    if (!state.justLocked) return;

    const accounts = yield* AccountRepositoryTag;
    const notifications = yield* NotificationPortTag;
    const user = yield* accounts.findByIdentifier(identifier);
    if (user === null) return;
    const to = yield* accounts.findContactAddress(user.id);
    if (to === null) return;

    yield* notifications.send({
      kind: NotificationKind.AccountLocked,
      userId: user.id,
      to,
      data: { retryAfterSeconds: String(state.retryAfterSeconds) },
    });
    // Accounting must never turn a wrong password into a 500.
  }).pipe(Effect.catchAll(() => Effect.void));

/** `POST /api/auth/logout` — revoke the session so every service sees it gone. */
const logoutRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const sessionId = asString(body['sessionId']);
  if (sessionId !== undefined) {
    const sessions = yield* SessionStoreTag;
    yield* sessions.revoke(sessionId);
  }
  return yield* HttpServerResponse.json({ ok: true });
}).pipe(Effect.catchAll(() => HttpServerResponse.json({ ok: true })));

/**
 * `POST /api/auth/refresh` — mint a fresh access token from a still-live
 * session, sliding its window. Fails `401` if the session was revoked, went idle
 * past its window, or reached its absolute ceiling — which is where the short
 * token TTL becomes real revocation.
 *
 * `touch` runs BEFORE the token is signed on purpose: a session that has hit its
 * ceiling must not hand out one last token on its way out.
 *
 * Sliding here rather than on every guarded request is deliberate.
 * `requirePrincipal` verifies statelessly and never reads the store, and putting
 * Redis back on that path to measure activity would undo the property. Instead
 * the browser stops refreshing once the user goes idle, so what renews a session
 * is a person using it rather than a tab being left open.
 */
const refreshRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const sessionId = asString(body['sessionId']);
  if (sessionId === undefined) {
    return yield* HttpServerResponse.json(
      { error: 'invalid request', code: 'invalidRequest' },
      { status: 400 },
    );
  }
  const sessions = yield* SessionStoreTag;
  const tokens = yield* TokenServiceTag;

  yield* sessions.touch(sessionId, SESSION_IDLE_TTL_SECONDS);
  const record = yield* sessions.read(sessionId);
  const accessToken = yield* tokens.sign(
    {
      userId: record.userId,
      subject: record.subject,
      sessionId,
      roles: record.roles,
      // The session owns the active organization, so a refresh preserves it —
      // including one chosen by an explicit switch rather than at sign-in.
      activeOrganizationId: record.activeOrganizationId,
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return yield* HttpServerResponse.json({
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    sessionExpiresIn: Math.max(
      0,
      Math.floor((Date.parse(record.absoluteExpiresAt) - Date.now()) / 1000),
    ),
    sessionExpiresAt: record.absoluteExpiresAt,
    principal: {
      userId: record.userId,
      subject: record.subject,
      sessionId,
      roles: record.roles,
      attributes: record.attributes,
    } satisfies Principal,
  });
}).pipe(
  Effect.catchAll(() =>
    HttpServerResponse.json(
      { error: 'session expired', code: 'sessionExpired' },
      { status: 401 },
    ),
  ),
);

// #endregion auth flow

// #region password

/**
 * `POST /api/auth/password` — a signed-in user changing their own password.
 *
 * Every OTHER session goes; this one stays. `revokeAllForUser` would sign the
 * user out of the screen they just used, which reads as a failure.
 */
const changePasswordRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const body = yield* readBody;
    const currentPassword = asString(body['currentPassword']);
    const newPassword = asString(body['newPassword']);
    if (currentPassword === undefined || newPassword === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'invalid request', code: 'invalidRequest' },
        { status: 400 },
      );
    }

    yield* changePasswordUCFactory().pipe(
      Effect.provideService(ChangePasswordInputTag, {
        userId: principal.userId,
        currentPassword,
        newPassword,
      }),
    );

    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUserExcept(
      principal.userId,
      principal.sessionId,
    );

    yield* notifyPasswordChanged(principal.userId);
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catchAll(respondAuthError)),
);

/** Tell the owner their password changed — best-effort, never blocking. */
const notifyPasswordChanged = (userId: Principal['userId']) =>
  Effect.gen(function* () {
    const accounts = yield* AccountRepositoryTag;
    const notifications = yield* NotificationPortTag;
    const to = yield* accounts.findContactAddress(userId);
    if (to === null) return;
    yield* notifications.send({
      kind: NotificationKind.PasswordChanged,
      userId,
      to,
    });
  }).pipe(Effect.catchAll(() => Effect.void));

/**
 * `POST /api/auth/password/forgot` — start recovery.
 *
 * Always `202`, whatever happened. A different status, body, or even a
 * noticeably different response time for a known address turns this endpoint
 * into a way to enumerate who has an account here.
 */
const forgotPasswordRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const identifier = asString(body['identifier']);
  const resetUrlBase =
    asString(body['resetUrlBase']) ??
    process.env.AUTH_APP_URL ??
    'http://localhost:3002';

  if (identifier !== undefined) {
    yield* requestPasswordResetUCFactory().pipe(
      Effect.provideService(RequestPasswordResetInputTag, {
        identifier,
        resetUrlBase,
      }),
      // Even a store outage answers the same way.
      Effect.catchAll(() => Effect.void),
    );
  }

  return yield* HttpServerResponse.json({ ok: true }, { status: 202 });
}).pipe(
  Effect.catchAllCause(() =>
    HttpServerResponse.json({ ok: true }, { status: 202 }),
  ),
);

/**
 * `POST /api/auth/password/reset` — redeem a reset link.
 *
 * Every session is revoked on success, without exception: recovery exists
 * precisely because the old password may be in someone else's hands, and
 * whoever that is may be signed in right now.
 */
const resetPasswordRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const token = asString(body['token']);
  const newPassword = asString(body['newPassword']);
  if (token === undefined || newPassword === undefined) {
    return yield* HttpServerResponse.json(
      { error: 'invalid request', code: 'invalidRequest' },
      { status: 400 },
    );
  }

  const userId = yield* resetPasswordUCFactory().pipe(
    Effect.provideService(ResetPasswordInputTag, { token, newPassword }),
  );

  const sessions = yield* SessionStoreTag;
  yield* sessions.revokeAllForUser(userId);

  yield* notifyPasswordChanged(userId);
  return yield* HttpServerResponse.json({ ok: true });
}).pipe(Effect.catchAll(respondAuthError));

// #endregion password

// #region development

/**
 * `GET /api/dev/outbox` — the notifications this service has sent.
 *
 * Gated on `NODE_ENV !== 'production'` and answering 404 otherwise, so the route
 * does not even admit to existing in a deployed environment. It exists because
 * the password-reset link is deliberately never returned in a response body:
 * without a readable record, the reset journey could not be tested end to end at
 * all, and an untested recovery flow is one that quietly rots.
 *
 * A single flag guards it, so the check is written once, here, rather than
 * repeated per handler where one omission would expose every reset link.
 */
const devOutboxRoute = Effect.gen(function* () {
  if (process.env.NODE_ENV === 'production') {
    return yield* HttpServerResponse.json(
      { error: 'not found', code: 'notFound' },
      { status: 404 },
    );
  }

  const db = yield* MongoDatabaseTag;
  const req = yield* HttpServerRequest.HttpServerRequest;
  const to = new URL(req.url, 'http://localhost').searchParams.get('to');
  const items = yield* readOutbox(db, to ?? undefined);
  return yield* HttpServerResponse.json({ items });
}).pipe(Effect.catchAllCause(serverError));

// #endregion development

// #region sessions

/** What a session row looks like on the wire. */
const serializeSession = (record: SessionRecord, currentSessionId: string) => ({
  sessionId: record.sessionId,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  absoluteExpiresAt: record.absoluteExpiresAt,
  /** So the UI can label the row you are reading it from. */
  current: record.sessionId === currentSessionId,
  device: record.device ?? null,
});

/** Read a user's live sessions, newest first. */
const listSessions = (userId: string, currentSessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const records = yield* sessions.listForUser(userId);
    return [...records]
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )
      .map(record => serializeSession(record, currentSessionId));
  });

/** `GET /api/auth/sessions` — where the caller is signed in. */
const mySessionsRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const items = yield* listSessions(
      String(principal.userId),
      principal.sessionId,
    );
    return yield* HttpServerResponse.json({ items });
  }).pipe(Effect.catchAll(serverError)),
);

/**
 * `DELETE /api/auth/sessions/:sessionId` — end one of the caller's sessions.
 *
 * The ownership check is the point. `SessionStore.revoke` will kill any id it is
 * handed, which was safe while only logout called it with your own; the moment a
 * route accepts an id from the outside, a session id that leaks into a log or a
 * URL becomes a remote-logout weapon. Revoking your CURRENT session is allowed
 * and simply signs you out.
 */
const revokeMySessionRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const target = params.sessionId ?? '';
    const sessions = yield* SessionStoreTag;

    const record = yield* sessions.read(target);
    if (String(record.userId) !== String(principal.userId)) {
      // Deliberately 404, not 403: confirming the id exists would tell a caller
      // they guessed a real session belonging to someone else.
      return yield* HttpServerResponse.json(
        { error: 'not found', code: 'notFound' },
        { status: 404 },
      );
    }

    yield* sessions.revoke(target);
    return yield* HttpServerResponse.json({
      ok: true,
      signedOut: target === principal.sessionId,
    });
  }).pipe(
    Effect.catchAll(() =>
      HttpServerResponse.json(
        { error: 'not found', code: 'notFound' },
        { status: 404 },
      ),
    ),
  ),
);

/** `POST /api/auth/sessions/revoke-others` — keep this one, end the rest. */
const revokeOtherSessionsRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUserExcept(
      principal.userId,
      principal.sessionId,
    );
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catchAll(serverError)),
);

/** `GET /api/auth/devices` — the caller's remembered browsers. */
const myDevicesRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const devices = yield* UserDeviceRepositoryTag;
    const items = yield* devices.listForUser(principal.userId);
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(UserDevice, items),
    });
    // `catchAllCause`, not `catchAll`: a bad value in a stored document throws
    // rather than failing, and a defect would otherwise escape as an empty 500
    // with nothing in the body to debug from.
  }).pipe(Effect.catchAllCause(serverError)),
);

// #endregion sessions

// #region user management

/** Every user-management route speaks this vocabulary, derived from the entity. */
const USER_READ = permissionForEntity(UserIdentity, 'read');
const USER_WRITE = permissionForEntity(UserIdentity, 'write');
const IDENTIFIER_READ = permissionForEntity(EntityIdentifier, 'read');
/** Looking at, and ending, somebody else's sessions. */
const DEVICE_READ = permissionForEntity(UserDevice, 'read');
const DEVICE_WRITE = permissionForEntity(UserDevice, 'write');

/**
 * `GET /api/user-identity/:id/sessions` — an administrator's view of where a
 * user is signed in, for incident response.
 *
 * Behind a permission derived from the entity itself, exactly like every other
 * administrative route. Another user's device history is not public just because
 * the caller happens to be staff.
 */
const userSessionsRoute = requirePermission(DEVICE_READ)(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const items = yield* listSessions(params.id ?? '', principal.sessionId);
    return yield* HttpServerResponse.json({ items });
  }).pipe(Effect.catchAll(serverError)),
);

/** `DELETE /api/user-identity/:id/sessions` — sign a user out everywhere. */
const revokeUserSessionsRoute = requirePermission(DEVICE_WRITE)(() =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUser(params.id ?? '');
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catchAll(serverError)),
);

/** Read the requested role from a body, rejecting an unrecognised one. */
const parseRole = (value: unknown): Role | undefined =>
  isRole(value) ? value : undefined;

/**
 * `POST /api/user-identity` — administrative account creation. Deliberately the
 * SAME use-case public signup runs: a generic entity write would skip password
 * hashing, identifier uniqueness and the tier rule. The actor comes from the
 * verified principal, never from the body.
 */
const createUserRoute = requirePermission(USER_WRITE)(principal =>
  Effect.gen(function* () {
    const body = yield* readBody;
    const input = yield* parseRegister(body);
    const role = parseRole(body['role']);
    if (body['role'] !== undefined && role === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown role', code: 'unknownRole' },
        { status: 400 },
      );
    }

    const subject = yield* registerUserUCFactory().pipe(
      Effect.provideService(RegisterInputTag, {
        ...input,
        role,
        actorRoles: principal.roles,
      }),
    );
    return yield* HttpServerResponse.json(subject, { status: 201 });
  }).pipe(Effect.catchAll(respondAuthError)),
);

/**
 * `PATCH /api/user-identity/:id` — change a user's role or status, then revoke
 * their sessions. Revocation is what makes the change immediate: grants are
 * derived from the `roles` claim, so without it a demoted user would keep their
 * old access until the token expired.
 */
const updateUserRoute = requirePermission(USER_WRITE)(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const body = yield* readBody;
    const userId = params.id ?? '';

    const role = parseRole(body['role']);
    if (body['role'] !== undefined && role === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown role', code: 'unknownRole' },
        { status: 400 },
      );
    }
    const rawStatus = asString(body['status']);
    const status = Object.values(UserStatus).includes(rawStatus as UserStatus)
      ? (rawStatus as UserStatus)
      : undefined;
    if (rawStatus !== undefined && status === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown status', code: 'unknownStatus' },
        { status: 400 },
      );
    }

    const updated = yield* updateUserAspectsUCFactory().pipe(
      Effect.provideService(UpdateUserAspectsInputTag, {
        userId,
        role,
        status,
        actorUserId: principal.userId,
        actorRoles: principal.roles,
      }),
    );

    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUser(userId);

    return yield* HttpServerResponse.json(
      serializeEntity(UserIdentity, updated),
    );
  }).pipe(Effect.catchAll(respondAuthError)),
);

// #endregion user management

/**
 * Everything the credential flow and a signed-in user's own account need.
 *
 * Split from {@link userManagementRoutes} because `pipe` accepts at most 20
 * arguments and this surface outgrew it — the seam is "your own identity" vs
 * "administering someone else's", which is the same line the permissions draw.
 */
const identityRoutes = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  // Credential flow.
  HttpRouter.post('/api/auth/register', registerRoute),
  HttpRouter.post('/api/auth/login', loginRoute),
  HttpRouter.post('/api/auth/logout', logoutRoute),
  HttpRouter.post('/api/auth/refresh', refreshRoute),
  // Session self-service. Every one of these resolves the caller from the
  // verified token and checks ownership — an id in the URL is never authority.
  HttpRouter.get('/api/auth/sessions', mySessionsRoute),
  HttpRouter.post('/api/auth/sessions/revoke-others', revokeOtherSessionsRoute),
  HttpRouter.del('/api/auth/sessions/:sessionId', revokeMySessionRoute),
  HttpRouter.get('/api/auth/devices', myDevicesRoute),
  // Password change + recovery.
  HttpRouter.post('/api/auth/password', changePasswordRoute),
  HttpRouter.post('/api/auth/password/forgot', forgotPasswordRoute),
  HttpRouter.post('/api/auth/password/reset', resetPasswordRoute),
  // Development only — 404s in production. See `devOutboxRoute`.
  HttpRouter.get('/api/dev/outbox', devOutboxRoute),
  // Resolve an opaque session id → principal via the framework-free use-case.
  HttpRouter.get(
    '/api/auth/session/:sessionId',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const sessionId = params.sessionId ?? '';
      const principal = yield* resolveSessionUCFactory().pipe(
        Effect.provideService(SessionIdTag, sessionId),
      );
      return yield* HttpServerResponse.json(principal);
    }).pipe(
      // Authn failures collapse to 401 at the perimeter; cause is not leaked.
      Effect.catchAll(() =>
        HttpServerResponse.json(
          { error: 'session could not be resolved', code: 'sessionUnresolved' },
          { status: 401 },
        ),
      ),
    ),
  ),
  // The caller's own verified identity — what a Next server layout reads to
  // decide whether to render the back-office and which nav items to show.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),
);

/** Administering other people's accounts. Every route here is permission-gated. */
const userManagementRoutes = HttpRouter.empty.pipe(
  // Canonical user records, backed by MongoDB. Every one of these is behind a
  // permission: this is the authorization boundary, and the UI hiding a menu
  // entry protects nothing on its own.
  HttpRouter.get(
    '/api/user-identity',
    requirePermission(USER_READ)(() => listRoute(UserIdentity)),
  ),
  HttpRouter.post('/api/user-identity', createUserRoute),
  HttpRouter.get(
    '/api/user-identity/:id',
    requirePermission(USER_READ)(() => byIdRoute(UserIdentity)),
  ),
  HttpRouter.patch('/api/user-identity/:id', updateUserRoute),
  // Administrative session control — incident response, permission-gated.
  HttpRouter.get('/api/user-identity/:id/sessions', userSessionsRoute),
  HttpRouter.del('/api/user-identity/:id/sessions', revokeUserSessionsRoute),
  HttpRouter.get(
    '/api/entity-identifier',
    requirePermission(IDENTIFIER_READ)(() => listRoute(EntityIdentifier)),
  ),
  HttpRouter.get(
    '/api/entity-identifier/:id',
    requirePermission(IDENTIFIER_READ)(() => byIdRoute(EntityIdentifier)),
  ),
  // Native-entity proof: construct entity classes + read stage-3 metadata.
  HttpRouter.get(
    '/api/identity/demo',
    Effect.sync(describeIdentityModel).pipe(
      Effect.flatMap(model => HttpServerResponse.json(model)),
    ),
  ),
);

/**
 * auth-service routes. `/api/health` is added by the service base. The auth
 * endpoints return JSON (tokens + principal); the Next app owns turning that
 * into httpOnly cookies, so this service needs no cookie/CORS handling.
 */
export const router = HttpRouter.concat(identityRoutes, userManagementRoutes);
