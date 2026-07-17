import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  EntityIdentifier,
  resolveSessionUCFactory,
  SessionIdTag,
  UserIdentity,
} from '@r10c/business-ts-authn';
import {
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  getUC,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import {
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
    const entity = yield* getUC.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor)
      ),
      Effect.provideService(EntityIdTag, params.id)
    );
    return yield* HttpServerResponse.json(
      serializeEntity(entityConstructor, entity as unknown as T)
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

/**
 * auth-service routes. `/api/health` is added by the service base.
 *
 * Session resolution stays a framework-free use-case over the (stub) identity
 * provider; the user records are served from MongoDB through the entifix
 * use-cases.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
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
