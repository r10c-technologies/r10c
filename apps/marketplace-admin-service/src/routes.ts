import { randomUUID } from 'node:crypto';

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  loadProductsUCFactory,
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
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
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import {
  makeMongoLinkResolver,
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  redactConfiguration,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { requirePrincipal } from './auth';
import {
  type CatalogHandlerOptions,
  makeCatalogTransactionHandler,
} from './catalog-transaction-handler';

/** Where a client polls a transaction it just accepted. */
const TRANSACTION_MANAGER_URL =
  process.env.TRANSACTION_MANAGER_URL ?? 'http://localhost:3103';

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
    { error: 'request failed', detail: String(error) },
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
        { error: 'invalid request body', detail: error.message },
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
        { error: 'invalid query', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

/**
 * The synchronous accept phase reports the command's fate to the client: a
 * malformed command is a `400`, lock contention a `409` (retry), anything else
 * a `500`. Failures after the `202` are the transaction-manager's concern, not
 * the client's.
 */
const acceptError = (error: unknown) =>
  error instanceof EntifixLockError
    ? HttpServerResponse.json(
        { error: 'resource busy, try again', detail: error.message },
        { status: 409 },
      )
    : error instanceof EntifixBuildError
      ? HttpServerResponse.json(
          { error: 'invalid command', detail: error.message },
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

/** Product list route: also resolves the `brand`/`category` links via Mongo. */
const productListRoute = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const request = yield* readLoadRequest(Product);
  const page = yield* loadProductsUCFactory().pipe(
    Effect.provideService(
      EntityRepositoryTag,
      makeMongoRepository(db, Product),
    ),
    Effect.provideService(EntityLoadRequestTag, request),
    Effect.provide(makeMongoLinkResolver(db, [ProductBrand, ProductCategory])),
  );
  return yield* HttpServerResponse.json(
    makeEntityPageEnvelope(Product, page, collectionLinks('product')),
  );
}).pipe(Effect.catchAll(readError));

/** Generic single-record route by `:id`. */
const byIdRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  label: string,
) =>
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
    Effect.catchAll(() =>
      HttpServerResponse.json(
        { message: `${label} not found` },
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
 * events. The client polls the transaction-manager for the outcome.
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
              href: `${TRANSACTION_MANAGER_URL}/api/transaction/${transactionId}`,
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
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // Token-verified backend integration: returns the caller's principal, proving
  // a downstream service trusts the access token auth-service minted.
  HttpRouter.get(
    '/api/me',
    requirePrincipal((principal) => HttpServerResponse.json(principal)),
  ),

  HttpRouter.get('/api/product-category', listRoute(ProductCategory)),
  HttpRouter.get(
    '/api/product-category/:id',
    byIdRoute(ProductCategory, 'Product category'),
  ),
  HttpRouter.post(
    '/api/product-category',
    createTransactionRoute(ProductCategory, {
      key: 'product-category',
      sequenceName: 'product-category',
      codePrefix: 'category',
    }),
  ),
  HttpRouter.put(
    '/api/product-category/:id',
    saveRoute(ProductCategory, { fromParams: true }),
  ),
  HttpRouter.del('/api/product-category/:id', deleteRoute(ProductCategory)),

  HttpRouter.get('/api/product-brand', listRoute(ProductBrand)),
  HttpRouter.get(
    '/api/product-brand/:id',
    byIdRoute(ProductBrand, 'Product brand'),
  ),
  HttpRouter.post(
    '/api/product-brand',
    createTransactionRoute(ProductBrand, {
      key: 'product-brand',
      sequenceName: 'product-brand',
      codePrefix: 'brand',
    }),
  ),
  HttpRouter.put(
    '/api/product-brand/:id',
    saveRoute(ProductBrand, { fromParams: true }),
  ),
  HttpRouter.del('/api/product-brand/:id', deleteRoute(ProductBrand)),

  HttpRouter.get('/api/product', productListRoute),
  HttpRouter.get('/api/product/:id', byIdRoute(Product, 'Product')),
  HttpRouter.post(
    '/api/product',
    createTransactionRoute(Product, {
      key: 'product',
      sequenceName: 'product',
      codePrefix: 'product',
    }),
  ),
  HttpRouter.put('/api/product/:id', saveRoute(Product, { fromParams: true })),
  HttpRouter.del('/api/product/:id', deleteRoute(Product)),
);
