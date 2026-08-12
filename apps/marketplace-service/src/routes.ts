import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { type Action, permissionForEntity } from '@r10c/business-ts-authz';
import {
  DictionaryTerm,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
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
  type EntifixEnvelopeLink,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  envelopeEntityName,
  extractMetaEntity,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
} from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  redactConfiguration,
  requirePermission,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/** Reads `rsql`/`sort`/`page`/`pageSize`, validated against entity metadata. */
const readLoadRequest = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(req.url, 'http://localhost').searchParams;
    return yield* Effect.try({
      try: () =>
        parseLoadRequestParams(
          entityConstructor,
          search,
        ) as unknown as EntityLoadRequest,
      catch: error => error as EntifixBuildError,
    });
  });

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

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

const readError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid query', code: 'invalidQuery', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

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
    service: '@r10c/marketplace-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});

/**
 * Guard a write with the permission the entity itself declares.
 *
 * No `requireOrganization` here, and that is the difference from
 * marketplace-admin-service: both of this slice's stores are platform plane and
 * `partitioning: 'single'`, so there is no tenant handle to resolve. A caller
 * needs the permission, not an organization.
 */
const guardedWrite = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: Effect.Effect<A, E, R>,
) =>
  requirePermission(permissionForEntity(entityConstructor, action))(
    () => route,
  );

/**
 * marketplace-service routes. `/api/health*` is added by the service base.
 *
 * **Reads are unauthenticated; writes are permission-gated.** That asymmetry is
 * the point of the platform plane: the storefront serves anonymous traffic and
 * must be able to read the catalog and its vocabulary without a session, while
 * only an operator authors either. A read that required a token would make the
 * storefront un-prerenderable, and a write that did not check one would let a
 * vendor rewrite the browse tree every other vendor is classified into.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),

  // The published catalog: read-only over HTTP by construction. Its only writer
  // is the projector that consumes `catalog.published`, so exposing a POST here
  // would create a second writer for a projection — the one thing
  // `truth: projection-of:` forbids.
  HttpRouter.get('/api/published-offering', listRoute(PublishedOffering)),
  HttpRouter.get('/api/published-offering/:id', byIdRoute(PublishedOffering)),

  // Brands and categories: the vocabulary a marketplace catalog is classified
  // in. Operator-authored, read by everyone — including anonymous storefront
  // traffic, which is why the reads carry no guard. They were per-vendor rows in
  // the tenant plane until ADR 0022; a browse tree cannot merge two vendors'
  // private "Electronics", so a marketplace has to own them centrally.
  HttpRouter.get('/api/product-brand', listRoute(ProductBrand)),
  HttpRouter.get('/api/product-brand/:id', byIdRoute(ProductBrand)),
  HttpRouter.post(
    '/api/product-brand',
    guardedWrite(
      ProductBrand,
      'write',
      saveRoute(ProductBrand, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/product-brand/:id',
    guardedWrite(
      ProductBrand,
      'write',
      saveRoute(ProductBrand, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/product-brand/:id',
    guardedWrite(ProductBrand, 'delete', deleteRoute(ProductBrand)),
  ),

  HttpRouter.get('/api/product-category', listRoute(ProductCategory)),
  HttpRouter.get('/api/product-category/:id', byIdRoute(ProductCategory)),
  HttpRouter.post(
    '/api/product-category',
    guardedWrite(
      ProductCategory,
      'write',
      saveRoute(ProductCategory, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/product-category/:id',
    guardedWrite(
      ProductCategory,
      'write',
      saveRoute(ProductCategory, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/product-category/:id',
    guardedWrite(ProductCategory, 'delete', deleteRoute(ProductCategory)),
  ),

  HttpRouter.get('/api/dictionary-term', listRoute(DictionaryTerm)),
  HttpRouter.get('/api/dictionary-term/:id', byIdRoute(DictionaryTerm)),
  HttpRouter.post(
    '/api/dictionary-term',
    guardedWrite(
      DictionaryTerm,
      'write',
      saveRoute(DictionaryTerm, { fromParams: false }),
    ),
  ),
  HttpRouter.put(
    '/api/dictionary-term/:id',
    guardedWrite(
      DictionaryTerm,
      'write',
      saveRoute(DictionaryTerm, { fromParams: true }),
    ),
  ),
  HttpRouter.del(
    '/api/dictionary-term/:id',
    guardedWrite(DictionaryTerm, 'delete', deleteRoute(DictionaryTerm)),
  ),
);
