import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { type Action, permissionForEntity } from '@r10c/business-ts-authz';
import {
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
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
} from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { requirePermission } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/**
 * The generic reads every route module in this service composes.
 *
 * ⚠️ **No tenant guard here, and that is the plane rather than an omission.**
 * The `order` store is **platform** plane and single-partitioned: one database,
 * named at boot, readable by the buyer on the order, the vendors on its lines
 * and the operator. stock-service resolves a `stock_<organizationId>` handle
 * inside every request; there is no handle to choose here, so routes are
 * guarded by permission alone (`docs/_shared/planes.md`).
 *
 * **Reads only.** The write is a checkout, and a checkout is not a save: it
 * holds stock in another party's tenant store before it writes anything, which
 * is a saga rather than a route
 * ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)). It lives in
 * `product-order.routes.ts` behind ADR 0023's crossing.
 */

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

export const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/**
 * An unparseable `rsql`, a member the entity never declared filterable, or a
 * value of the wrong type is the client's mistake, so it is a `400` rather than
 * a `500`. `EntifixError`s are plain `Error`s carrying a `_tag` field rather
 * than `Data.TaggedError`s, so they are discriminated with `instanceof` —
 * `Effect.catchTag` would not match.
 */
const readError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid query', code: 'invalidQuery', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

/**
 * The HATEOAS affordances for a single record. Only this service knows its own
 * route surface, so links are filled in here rather than by the envelope
 * builders in `core`.
 *
 * ⚠️ **No `update` link.** An order's lines are a `composition` fixed at
 * checkout — the price a buyer was charged is the price they were shown — and a
 * client that rendered a Save from an advertised affordance would be offering to
 * rewrite a receipt.
 */
const entityLinks = (key: string, id: EntityId): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}/${String(id)}`, method: 'GET' },
  { rel: 'list', href: `/api/${key}`, method: 'GET' },
];

const collectionLinks = (key: string): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}`, method: 'GET' },
];

/** Generic list route for an entity, backed by Mongo + the entifix load UC. */
export const listRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
) =>
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
export const byIdRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
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
 * Guard a platform-plane read: check the permission the entity derives, and
 * nothing else.
 *
 * ⚠️ **Deliberately not `requireOrganization`.** A buyer's session names no
 * organization at all, and answering `409 noActiveOrganization` to the person
 * whose order it is would be a broken screen with a plausible-looking error. The
 * scoping this route needs is *whose orders these are*, which is a filter rather
 * than a database handle — and it is the residual named on the route module.
 */
export const guarded = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: Effect.Effect<A, E, R>,
) =>
  requirePermission(permissionForEntity(entityConstructor, action))(
    () => route,
  );
