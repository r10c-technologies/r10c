import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  type AuthSubject,
  EntityIdentifier,
  type IdentifierType,
  LoginInputTag,
  loginUCFactory,
  type Principal,
  RegisterInputTag,
  registerUserUCFactory,
  resolveSessionUCFactory,
  SessionIdTag,
  UpdateUserAspectsInputTag,
  updateUserAspectsUCFactory,
  UserIdentity,
  UserStatus,
} from '@r10c/business-ts-authn';
import {
  isRole,
  permissionForEntity,
  type Role,
} from '@r10c/business-ts-authz';
import {
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
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

import { describeIdentityModel } from './identity/identity-showcase';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  SESSION_TTL_SECONDS,
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
  readonly expiresIn: number;
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

/**
 * Turn a credential-verified {@link AuthSubject} into a live session + access
 * token. The session lands in Redis (revocation handle); the token carries only
 * the small, stable claims a downstream authorization check needs.
 */
const establishSession = (
  subject: AuthSubject,
): Effect.Effect<AuthResult, never, SessionStoreTag | TokenServiceTag> =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const tokens = yield* TokenServiceTag;

    const sessionId = yield* sessions.create(subject, SESSION_TTL_SECONDS);
    const accessToken = yield* tokens.sign(
      {
        userId: subject.userId,
        subject: subject.subject,
        sessionId,
        roles: subject.roles,
      },
      ACCESS_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      sessionId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      principal: { ...subject, sessionId },
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
  const result = yield* establishSession(subject);
  return yield* HttpServerResponse.json(result, { status: 201 });
}).pipe(Effect.catchAll(respondAuthError));

/** `POST /api/auth/login` — verify credentials and open a session. */
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
  const subject = yield* loginUCFactory().pipe(
    Effect.provideService(LoginInputTag, { identifier, password }),
  );
  const result = yield* establishSession(subject);
  return yield* HttpServerResponse.json(result, { status: 200 });
}).pipe(Effect.catchAll(respondAuthError));

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
 * session, sliding its TTL. Fails `401` if the session was revoked or expired,
 * which is where B's short token TTL becomes real revocation.
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

  const record = yield* sessions.read(sessionId);
  yield* sessions.touch(sessionId, SESSION_TTL_SECONDS);
  const accessToken = yield* tokens.sign(
    {
      userId: record.userId,
      subject: record.subject,
      sessionId,
      roles: record.roles,
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return yield* HttpServerResponse.json({
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
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
    HttpServerResponse.json({ error: 'session expired', code: 'sessionExpired' }, { status: 401 }),
  ),
);

// #endregion auth flow

// #region user management

/** Every user-management route speaks this vocabulary, derived from the entity. */
const USER_READ = permissionForEntity(UserIdentity, 'read');
const USER_WRITE = permissionForEntity(UserIdentity, 'write');
const IDENTIFIER_READ = permissionForEntity(EntityIdentifier, 'read');

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
 * auth-service routes. `/api/health` is added by the service base. The auth
 * endpoints return JSON (tokens + principal); the Next app owns turning that
 * into httpOnly cookies, so this service needs no cookie/CORS handling.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  // Credential flow.
  HttpRouter.post('/api/auth/register', registerRoute),
  HttpRouter.post('/api/auth/login', loginRoute),
  HttpRouter.post('/api/auth/logout', logoutRoute),
  HttpRouter.post('/api/auth/refresh', refreshRoute),
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
    requirePermission(USER_READ)(() =>
      byIdRoute(UserIdentity),
    ),
  ),
  HttpRouter.patch('/api/user-identity/:id', updateUserRoute),
  HttpRouter.get(
    '/api/entity-identifier',
    requirePermission(IDENTIFIER_READ)(() => listRoute(EntityIdentifier)),
  ),
  HttpRouter.get(
    '/api/entity-identifier/:id',
    requirePermission(IDENTIFIER_READ)(() =>
      byIdRoute(EntityIdentifier),
    ),
  ),
  // Native-entity proof: construct entity classes + read stage-3 metadata.
  HttpRouter.get(
    '/api/identity/demo',
    Effect.sync(describeIdentityModel).pipe(
      Effect.flatMap(model => HttpServerResponse.json(model)),
    ),
  ),
);
