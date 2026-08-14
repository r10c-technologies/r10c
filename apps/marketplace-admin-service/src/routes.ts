import { randomUUID } from 'node:crypto';

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { type Action, permissionForEntity } from '@r10c/business-ts-authz';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  acceptTransaction,
  CommandTag,
  completeTransaction,
  SequenceServiceTag,
  type TransactionCommand,
  TransactionHandlerTag,
} from '@r10c/entifix-transactions';
import {
  ConfigurationRepositoryTag,
  deleteUCFactory,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  EntityTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
  TenantDatabaseResolverTag,
} from '@r10c/entifix-ts-business';
import {
  EntifixBuildError,
  EntifixEnvelopeLink,
  EntifixLockError,
  Entity,
  EntityConstructor,
  EntityId,
  EntityLoadRequest,
  envelopeEntityName,
  extractMetaEntity,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  redactConfiguration,
  requireOrganization,
  requirePrincipal,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import {
  type CatalogHandlerOptions,
  makeCatalogTransactionHandler,
} from './catalog-transaction-handler';
import { sagaRoutes } from './saga/routes';

/**
 * Reads the load request from the query string: `rsql` (filtering), `sort`,
 * `page` and `pageSize`. Parsing is done by the shared codec in
 * `entifix-ts-core` — the same one the REST client serializes with — and is
 * validated against the entity's own metadata, so a client can only name
 * members the entity declared filterable/sortable.
 */
const readLoadRequest = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(req.url, 'http://localhost').searchParams;
    return yield* Effect.try({
      try: () =>
        // `EntityLoadRequestTag` deliberately carries no generic, so the
        // entity-typed request is cast across it — the same crossing
        // `loadUCFactory` makes in the opposite direction when it reads it back.
        parseLoadRequestParams(
          entityConstructor,
          search,
        ) as unknown as EntityLoadRequest,
      // The codec throws rather than failing an Effect (it is framework-free),
      // so the build error is caught back into the failure channel here.
      catch: error => error as EntifixBuildError,
    });
  });

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/**
 * A malformed envelope is the client's fault, not ours. `EntifixError`s are
 * plain `Error`s carrying a `_tag` field rather than `Data.TaggedError`s, so
 * they are discriminated with `instanceof` — `Effect.catchTag` would not match.
 */
const writeError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        {
          error: 'invalid request body',
          code: 'invalidBody',
          detail: error.message,
        },
        { status: 400 },
      )
    : serverError(error);

/**
 * The read mirror of {@link writeError}: an unparseable `rsql`, a member the
 * entity never declared filterable, or a value of the wrong type is the
 * client's mistake, so it is a `400` rather than a `500`.
 */
const readError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid query', code: 'invalidQuery', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

/**
 * The synchronous accept phase reports the command's fate to the client: a
 * malformed command is a `400`, lock contention a `409` (retry), anything else
 * a `500`. Failures after the `202` are the saga tracker's concern, not
 * the client's.
 */
const acceptError = (error: unknown) =>
  error instanceof EntifixLockError
    ? HttpServerResponse.json(
        {
          error: 'resource busy, try again',
          code: 'resourceBusy',
          detail: error.message,
        },
        { status: 409 },
      )
    : error instanceof EntifixBuildError
      ? HttpServerResponse.json(
          {
            error: 'invalid command',
            code: 'invalidCommand',
            detail: error.message,
          },
          { status: 400 },
        )
      : serverError(error);

/**
 * The HATEOAS affordances for a single record. Only this service knows its own
 * route surface, so links are filled in here rather than by the envelope
 * builders in `core`.
 */
const entityLinks = (key: string, id: EntityId): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}/${String(id)}`, method: 'GET' },
  { rel: 'list', href: `/api/${key}`, method: 'GET' },
  { rel: 'update', href: `/api/${key}/${String(id)}`, method: 'PUT' },
  { rel: 'delete', href: `/api/${key}/${String(id)}`, method: 'DELETE' },
];

const collectionLinks = (key: string): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}`, method: 'GET' },
  { rel: 'create', href: `/api/${key}`, method: 'POST' },
];

/** Generic list route for an entity, backed by Mongo + the entifix load UC. */
const listRoute = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const request = yield* readLoadRequest(entityConstructor);
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityLoadRequestTag, request),
    );
    return yield* HttpServerResponse.json(
      makeEntityPageEnvelope(
        entityConstructor,
        page,
        collectionLinks(envelopeEntityName(entityConstructor)),
      ),
    );
  }).pipe(Effect.catchAll(readError));

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
    const key = envelopeEntityName(entityConstructor);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(
        entityConstructor,
        entity,
        entityLinks(key, params.id),
      ),
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

/**
 * Generic create/update route. The request body is an envelope, and so is the
 * response: it carries the entity as *stored*, which is how a create learns the
 * id the adapter minted for it.
 *
 * On update the URL is authoritative — the id from the path overrides whatever
 * the body claimed, so a record cannot be renamed by editing its payload.
 */
const saveRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  { fromParams }: { fromParams: boolean },
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const entity = yield* readEntityEnvelope(entityConstructor, body);

    if (fromParams) {
      const params = yield* HttpRouter.params;
      entity.id = params.id;
    }

    const saved = yield* saveUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityTag, entity),
    );

    const key = envelopeEntityName(entityConstructor);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(entityConstructor, saved, entityLinks(key, saved.id)),
    );
  }).pipe(Effect.catchAll(writeError));

/**
 * Transactional create route (the CQRS write path). A `POST` is a *command*:
 * the service runs the accept phase (validate -> lock) synchronously, answers
 * `202` with a transaction id, and forks the execute phase (assign code ->
 * persist -> free, or rollback -> free) as a daemon that publishes lifecycle
 * events. The client polls the saga tracker for the outcome.
 *
 * The request body is still an entity envelope (the admin app is unchanged on
 * the wire), which is re-serialized into the command payload.
 */
const createTransactionRoute = <
  T extends Entity & { code?: string; name?: string },
>(
  entityConstructor: EntityConstructor<T>,
  options: CatalogHandlerOptions,
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const store = yield* ConfigurationRepositoryTag;
    const sequence = yield* SequenceServiceTag;

    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const entity = yield* readEntityEnvelope(entityConstructor, body);

    const transactionId = randomUUID();
    const command: TransactionCommand = {
      transactionId,
      type: 'create',
      entity: options.key,
      payload: serializeEntity(entityConstructor, entity),
    };
    const handler = makeCatalogTransactionHandler(
      db,
      store,
      sequence,
      entityConstructor,
      options,
    );

    // Accept phase — synchronous; its failure is the client's 400/409.
    const handles = yield* acceptTransaction().pipe(
      Effect.provideService(CommandTag, command),
      Effect.provideService(TransactionHandlerTag, handler),
    );

    // Execute phase — forked past the 202 so the request returns immediately.
    yield* completeTransaction(handles).pipe(
      Effect.provideService(CommandTag, command),
      Effect.provideService(TransactionHandlerTag, handler),
      Effect.forkDaemon,
    );

    return yield* HttpServerResponse.json(
      {
        meta: {
          type: 'transactionEvent',
          entity: options.key,
          links: [
            {
              rel: 'status',
              // Relative: the tracker answers on this same origin now that the
              // `transaction` slice is co-deployed here. A client already knows
              // the host it POSTed to, and keeping the link relative means
              // splitting the slice back out changes a deployment, not a
              // response body.
              href: `/api/transaction/${transactionId}`,
              method: 'GET',
            },
          ],
        },
        data: { transactionId, state: 'PENDING' },
      },
      { status: 202 },
    );
  }).pipe(Effect.catchAll(acceptError));

/**
 * Generic delete route. Answers with an envelope rather than a bare `204`: the
 * entifix fetch client always parses the response as JSON, and every message
 * between entifix artifacts is an envelope.
 */
const deleteRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;

    yield* deleteUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityIdTag, params.id),
    );

    const key = envelopeEntityName(entityConstructor);
    return yield* HttpServerResponse.json({
      meta: { type: 'entity', entity: key, links: collectionLinks(key) },
      data: { id: params.id },
    });
  }).pipe(Effect.catchAll(serverError));

/** `GET /api/config` — this service's loaded parameters (credentials redacted). */
const configIntrospectionRoute = Effect.gen(function* () {
  const plain = yield* LoadedConfigurationTag;
  return yield* HttpServerResponse.json({
    service: '@r10c/marketplace-admin-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});

/**
 * marketplace-admin-service catalog routes, backed by MongoDB through the
 * entifix use-cases. `/api/health` is added by the service base.
 *
 * Paths are literals that match each entity's `key` by convention — the same
 * string the REST client composes its URLs from and the Mongo adapter uses as a
 * collection name.
 */
/**
 * Guard a catalog route with the permission its own entity declares, **and**
 * bind it to the caller's tenant storage.
 *
 * Deriving the permission from `@entity({ domain, key })` means adding an entity
 * cannot leave a hole: there is no separate list of permission strings to forget
 * to extend.
 *
 * The tenancy half is the reason this is one function rather than an edit in
 * every handler. The catalog is **tenant plane**: each vendor authors its own,
 * in its own Mongo database. Every route below already resolves its database
 * inside the request (`const db = yield* MongoDatabaseTag`), so re-providing
 * that tag with the organization's handle redirects all of them at once — no
 * use-case, entity, repository, filter translator or envelope is touched. That
 * substitutability is the whole point of resolving the handle per request
 * instead of baking it into a `Layer`.
 *
 * The organization comes from the verified token via `requireOrganization`,
 * never from a path or query parameter, and a caller with no tenant scope gets
 * `409 noActiveOrganization` rather than another tenant's data.
 */
const guarded = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: () => Effect.Effect<A, E, R>,
) =>
  requireOrganization(permissionForEntity(entityConstructor, action))(
    organizationId =>
      Effect.gen(function* () {
        const resolver = yield* TenantDatabaseResolverTag;
        // The tag is datastore-agnostic (`TenantDatabaseResolver<unknown>`) so
        // that a Postgres adapter can satisfy it later; this service knows it
        // provided the Mongo one, which is what the cast records.
        const db = (yield* resolver.forOrganization(organizationId)) as Db;
        return yield* route().pipe(Effect.provideService(MongoDatabaseTag, db));
      }).pipe(
        // Each route already maps its own failures; what can still fail here is
        // resolving the tenant handle.
        Effect.catchAll(serverError),
      ),
  );

export const router = sagaRoutes(HttpRouter.empty).pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // Token-verified backend integration: returns the caller's principal, proving
  // a downstream service trusts the access token auth-service minted.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),

  HttpRouter.get(
    '/api/product-specification',
    guarded(ProductSpecification, 'read', () =>
      listRoute(ProductSpecification),
    ),
  ),
  HttpRouter.get(
    '/api/product-specification/:id',
    guarded(ProductSpecification, 'read', () =>
      byIdRoute(ProductSpecification),
    ),
  ),
  HttpRouter.post(
    '/api/product-specification',
    guarded(ProductSpecification, 'write', () =>
      createTransactionRoute(ProductSpecification, {
        key: 'product-specification',
        sequenceName: 'product-specification',
        codePrefix: 'product',
      }),
    ),
  ),
  HttpRouter.put(
    '/api/product-specification/:id',
    guarded(ProductSpecification, 'write', () =>
      saveRoute(ProductSpecification, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/product-specification/:id',
    guarded(ProductSpecification, 'delete', () =>
      deleteRoute(ProductSpecification),
    ),
  ),
);
