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
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(entityConstructor, page.items),
      total: page.total,
      request: page.request,
    });
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
  return yield* HttpServerResponse.json({
    items: serializeEntityCollection(Product, page.items),
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
    service: '@r10c/marketplace-admin-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});

/**
 * marketplace-admin-service catalog routes, backed by MongoDB through the
 * entifix use-cases. `/api/health` is added by the service base.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  HttpRouter.get('/api/product-category', listRoute(ProductCategory)),
  HttpRouter.get(
    '/api/product-category/:id',
    byIdRoute(ProductCategory, 'Product category')
  ),
  HttpRouter.get('/api/product-brand', listRoute(ProductBrand)),
  HttpRouter.get(
    '/api/product-brand/:id',
    byIdRoute(ProductBrand, 'Product brand')
  ),
  HttpRouter.get('/api/product', productListRoute),
  HttpRouter.get('/api/product/:id', byIdRoute(Product, 'Product'))
);
