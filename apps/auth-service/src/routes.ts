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
  UserIdentity,
} from '@r10c/business-ts-authn';
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
    { error: 'request failed', detail: String(error) },
    { status: 500 }
  );

/** Generic list route backed by Mongo + the entifix load UC. */
const listRoute = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const request = yield* readLoadRequest;
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor)
      ),
      Effect.provideService(EntityLoadRequestTag, request)
    );
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(entityConstructor, page.items),
      total: page.total,
      request: page.request,
    });
  }).pipe(Effect.catchAll(serverError));

/** Generic single-record route by `:id`. */
const byIdRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  label: string
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;
    const entity = yield* getUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor)
      ),
      Effect.provideService(EntityIdTag, params.id)
    );
    return yield* HttpServerResponse.json(
      serializeEntity(entityConstructor, entity)
    );
  }).pipe(
    Effect.catchAll(() =>
      HttpServerResponse.json({ message: `${label} not found` }, { status: 404 })
    )
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

/** Map an authn failure to a status without leaking the cause. */
const respondAuthError = (error: { _tag?: string }) => {
  switch (error._tag) {
    case 'UnauthenticatedError':
      return HttpServerResponse.json(
        { error: 'invalid credentials' },
        { status: 401 }
      );
    case 'AuthnError':
      return HttpServerResponse.json(
        { error: 'identifier already in use' },
        { status: 409 }
      );
    case 'EntifixBuildError':
      return HttpServerResponse.json(
        { error: 'invalid request' },
        { status: 400 }
      );
    default:
      return HttpServerResponse.json(
        { error: 'authentication failed' },
        { status: 500 }
      );
  }
};

/**
 * Turn a credential-verified {@link AuthSubject} into a live session + access
 * token. The session lands in Redis (revocation handle); the token carries only
 * the small, stable claims a downstream authorization check needs.
 */
const establishSession = (
  subject: AuthSubject
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
      ACCESS_TOKEN_TTL_SECONDS
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
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        type: asString(entry['type']) as IdentifierType | undefined,
        value: asString(entry['value']),
      }))
      .filter(
        (entry): entry is { type: IdentifierType; value: string } =>
          entry.type !== undefined && entry.value !== undefined
      );

    if (password === undefined || identifiers.length === 0) {
      return yield* Effect.fail(
        new EntifixBuildError('registration requires a password and identifier')
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
    Effect.provideService(RegisterInputTag, input)
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
      { error: 'invalid request' },
      { status: 400 }
    );
  }
  const subject = yield* loginUCFactory().pipe(
    Effect.provideService(LoginInputTag, { identifier, password })
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
      { error: 'invalid request' },
      { status: 400 }
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
    ACCESS_TOKEN_TTL_SECONDS
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
    HttpServerResponse.json({ error: 'session expired' }, { status: 401 })
  )
);

// #endregion auth flow

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
        Effect.provideService(SessionIdTag, sessionId)
      );
      return yield* HttpServerResponse.json(principal);
    }).pipe(
      // Authn failures collapse to 401 at the perimeter; cause is not leaked.
      Effect.catchAll(() =>
        HttpServerResponse.json(
          { error: 'session could not be resolved' },
          { status: 401 }
        )
      )
    )
  ),
  // Canonical user records, backed by MongoDB.
  HttpRouter.get('/api/user-identity', listRoute(UserIdentity)),
  HttpRouter.get(
    '/api/user-identity/:id',
    byIdRoute(UserIdentity, 'User identity')
  ),
  HttpRouter.get('/api/entity-identifier', listRoute(EntityIdentifier)),
  HttpRouter.get(
    '/api/entity-identifier/:id',
    byIdRoute(EntityIdentifier, 'Entity identifier')
  ),
  // Native-entity proof: construct entity classes + read stage-3 metadata.
  HttpRouter.get(
    '/api/identity/demo',
    Effect.sync(describeIdentityModel).pipe(
      Effect.flatMap((model) => HttpServerResponse.json(model))
    )
  )
);
