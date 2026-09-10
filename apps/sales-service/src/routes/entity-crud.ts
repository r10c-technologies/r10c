import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { type Action, permissionForEntity } from '@r10c/business-ts-authz';
import {
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
import { requireOrganization } from '@r10c/shells-effect-service';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/**
 * The generic CRUD routes and the tenant guard every route module here
 * composes.
 *
 * **Reads *and* writes**, which is the difference from stock-service's file of
 * the same name and not an oversight in either. A `StockItem`'s counters move by
 * `$inc` over an append-only ledger, so a save route there would be the
 * read-modify-write [ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)
 * forbids. A `SalesChannel` is the opposite kind of record: a vendor types its
 * name, picks its type and retires it, and nothing else in the fleet writes one.
 * So this file is the tenant-plane CRUD shape marketplace-admin-service has,
 * minus the transactional create — a channel announces nothing on the bus and
 * takes no lock, so a `202` and a saga tracker would be ceremony over a single
 * document write.
 */

/**
 * Reads the load request from the query string: `rsql` (filtering), `sort`,
 * `page` and `pageSize`, validated against the entity's own metadata — so a
 * client can only name members the entity declared filterable or sortable.
 */
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

export const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/** A body the entity cannot deserialize is the caller's mistake, not a `500`. */
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

/** The read mirror of {@link writeError}. */
const readError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid query', code: 'invalidQuery', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

/**
 * The HATEOAS affordances for a single record. Only this service knows its own
 * route surface, so the links are filled in here rather than by the envelope
 * builders in `core` — and they carry `update` and `delete`, because unlike
 * stock's this service really does serve both.
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
 * Generic create/update route. The request body is an envelope and so is the
 * response, which carries the entity as *stored* — how a create learns the id
 * the adapter minted for it.
 *
 * On update the URL is authoritative: the id from the path overrides whatever
 * the body claimed, so a record cannot be renamed onto another one by editing
 * its payload.
 */
export const saveRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  {
    fromParams,
    validate,
  }: {
    fromParams: boolean;
    /**
     * A closed-set check the deserializer does not make.
     *
     * ⚠️ **`enumValues` on an accessor is metadata, not a server-side
     * validator.** It is what the form renders a select from and what the
     * `$metadata` document advertises; `readEntityEnvelope` will happily set a
     * member to a string outside the set, and every other service in the fleet
     * accepts one. It is refused here because a channel *type* is priced
     * against: settlement reads it to pick a commission rate, and a type nobody
     * has a rate for silently falls through to the agreement's default — a
     * wrong invoice rather than an error (ADR 0056).
     */
    validate?: (entity: T) => EntifixBuildError | undefined;
  },
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

    const invalid = validate?.(entity);
    if (invalid) {
      return yield* Effect.fail(invalid);
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
 * Generic delete route. Answers with an envelope rather than a bare `204`: the
 * entifix fetch client parses every response as JSON, and every message between
 * entifix artifacts is an envelope.
 */
export const deleteRoute = <T extends Entity>(
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

/**
 * Resolve the organization's database and run the route against it.
 *
 * The handle is resolved **inside** the request: the pool is the boot-time
 * `MongoClientLayer`, and a per-request `Layer` would rebuild the pool per
 * request.
 */
export const withTenantDatabase = <A, E, R>(
  organizationId: string,
  route: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const resolver = yield* TenantDatabaseResolverTag;
    // The tag is datastore-agnostic (`TenantDatabaseResolver<unknown>`) so that
    // a Postgres adapter can satisfy it later; this service knows it provided
    // the Mongo one, which is what the cast records.
    const db = (yield* resolver.forOrganization(organizationId)) as Db;
    return yield* route.pipe(Effect.provideService(MongoDatabaseTag, db));
  }).pipe(Effect.catchAll(serverError));

/**
 * Guard a tenant-plane route: check the permission the entity derives, then
 * bind the request to the caller's organization database.
 *
 * The organization comes from the verified token and nowhere else, so no
 * handler here can be made to read or write another vendor's channels through a
 * query parameter. A principal who has picked no organization gets
 * `409 noActiveOrganization` rather than somebody else's data.
 */
export const guarded = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: (organizationId: string) => Effect.Effect<A, E, R>,
) =>
  requireOrganization(permissionForEntity(entityConstructor, action))(
    organizationId => withTenantDatabase(organizationId, route(organizationId)),
  );
