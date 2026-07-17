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
  Entity,
  EntityConstructor,
  EntityId,
  EntityLoadRequest,
  envelopeEntityName,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  readEntityEnvelope,
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

/**
 * A malformed envelope is the client's fault, not ours. `EntifixError`s are
 * plain `Error`s carrying a `_tag` field rather than `Data.TaggedError`s, so
 * they are discriminated with `instanceof` — `Effect.catchTag` would not match.
 */
const writeError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid request body', detail: error.message },
        { status: 400 }
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
    const request = yield* readLoadRequest;
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor)
      ),
      Effect.provideService(EntityLoadRequestTag, request)
    );
    return yield* HttpServerResponse.json(
      makeEntityPageEnvelope(
        entityConstructor,
        page,
        collectionLinks(envelopeEntityName(entityConstructor))
      )
    );
  }).pipe(Effect.catchAll(serverError));

/** Product list route: also resolves the `brand`/`category` links via Mongo. */
const productListRoute = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const request = yield* readLoadRequest;
  const page = yield* loadProductsUCFactory().pipe(
    Effect.provideService(EntityRepositoryTag, makeMongoRepository(db, Product)),
    Effect.provideService(EntityLoadRequestTag, request),
    Effect.provide(makeMongoLinkResolver(db, [ProductBrand, ProductCategory]))
  );
  return yield* HttpServerResponse.json(
    makeEntityPageEnvelope(Product, page, collectionLinks('product'))
  );
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
    const key = envelopeEntityName(entityConstructor);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(entityConstructor, entity, entityLinks(key, params.id))
    );
  }).pipe(
    Effect.catchAll(() =>
      HttpServerResponse.json({ message: `${label} not found` }, { status: 404 })
    )
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
  { fromParams }: { fromParams: boolean }
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
        makeMongoRepository(db, entityConstructor)
      ),
      Effect.provideService(EntityTag, entity)
    );

    const key = envelopeEntityName(entityConstructor);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(entityConstructor, saved, entityLinks(key, saved.id))
    );
  }).pipe(Effect.catchAll(writeError));

/**
 * Generic delete route. Answers with an envelope rather than a bare `204`: the
 * entifix fetch client always parses the response as JSON, and every message
 * between entifix artifacts is an envelope.
 */
const deleteRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;

    yield* deleteUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor)
      ),
      Effect.provideService(EntityIdTag, params.id)
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

  HttpRouter.get('/api/product-category', listRoute(ProductCategory)),
  HttpRouter.get(
    '/api/product-category/:id',
    byIdRoute(ProductCategory, 'Product category')
  ),
  HttpRouter.post(
    '/api/product-category',
    saveRoute(ProductCategory, { fromParams: false })
  ),
  HttpRouter.put(
    '/api/product-category/:id',
    saveRoute(ProductCategory, { fromParams: true })
  ),
  HttpRouter.del('/api/product-category/:id', deleteRoute(ProductCategory)),

  HttpRouter.get('/api/product-brand', listRoute(ProductBrand)),
  HttpRouter.get(
    '/api/product-brand/:id',
    byIdRoute(ProductBrand, 'Product brand')
  ),
  HttpRouter.post(
    '/api/product-brand',
    saveRoute(ProductBrand, { fromParams: false })
  ),
  HttpRouter.put(
    '/api/product-brand/:id',
    saveRoute(ProductBrand, { fromParams: true })
  ),
  HttpRouter.del('/api/product-brand/:id', deleteRoute(ProductBrand)),

  HttpRouter.get('/api/product', productListRoute),
  HttpRouter.get('/api/product/:id', byIdRoute(Product, 'Product')),
  HttpRouter.post('/api/product', saveRoute(Product, { fromParams: false })),
  HttpRouter.put('/api/product/:id', saveRoute(Product, { fromParams: true })),
  HttpRouter.del('/api/product/:id', deleteRoute(Product))
);
