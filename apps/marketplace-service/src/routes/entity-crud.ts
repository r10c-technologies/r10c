import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  type Action,
  type Permission,
  permissionForEntity,
} from '@r10c/business-ts-authz';
import {
  RetireReferenceInputTag,
  retireReferences,
} from '@r10c/business-ts-catalog-reference';
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
  type EntitySelection,
  envelopeEntityName,
  extractMetaEntity,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
  readWireSelection,
} from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { requirePermission } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/**
 * The generic entity CRUD every route module in this service composes.
 *
 * Extracted so each entity gets its own file: a corner case on one entity — a
 * projection that must never accept a write, a list that needs a different
 * link set — is then a change to that entity's module rather than an `if` in a
 * shared handler. The composition is by function call, not by configuration.
 */

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

export const saveRoute = <T extends Entity>(
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
 * Guard a write with the permission the entity itself declares.
 *
 * No `requireOrganization` here, and that is the difference from
 * marketplace-admin-service: both of this slice's stores are platform plane and
 * `partitioning: 'single'`, so there is no tenant handle to resolve. A caller
 * needs the permission, not an organization.
 */
export const guardedWrite = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: Effect.Effect<A, E, R>,
) =>
  requirePermission(permissionForEntity(entityConstructor, action))(
    () => route,
  );

/**
 * Resolve the rows a bulk request names into a list of ids.
 *
 * The two selection modes are two different jobs, which is exactly why the wire
 * shape keeps them apart. `ids` is already the answer. `matching` is a **filter
 * the server evaluates** — the set is by definition larger than the page the
 * browser was showing, so there is nothing for the client to enumerate and
 * asking it to would be both a huge request and a lie about what it saw.
 *
 * The `matching` branch reads through the same `loadUCFactory` the listing
 * does, so the rows a bulk action touches are the rows the filter shows: one
 * query path, one RSQL allowlist, no second interpretation of the filter to
 * drift.
 *
 * `excluded` is applied here rather than pushed into the query — it is a
 * handful of ids the operator ticked off, and turning it into a `nin` clause
 * would put user input into a filter for no benefit.
 */
const resolveSelection = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  selection: EntitySelection<T>,
) =>
  Effect.gen(function* () {
    // `Array.from`, never a spread: this package compiles through SWC's loose
    // helper, which wraps a `Set` rather than iterating it (see
    // `toWireSelection` in core).
    if (selection.mode === 'ids') return Array.from(selection.ids);

    const db = yield* MongoDatabaseTag;
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityLoadRequestTag, {
        filtering: selection.filtering,
        // One page, capped. A bulk action over more rows than this is a saga
        // rather than a request (#121), and returning a partial result under a
        // cap is honest where a silent timeout is not.
        page: 1,
        pageSize: BULK_SELECTION_CAP,
      } as unknown as EntityLoadRequest),
    );

    const excluded = new Set(Array.from(selection.excluded).map(String));
    return page.items
      .map(item => item.id)
      .filter(id => !excluded.has(String(id)));
  });

/**
 * The most rows one bulk request will touch.
 *
 * A ceiling rather than unbounded, because the alternative is a request that
 * holds a connection open for minutes and then fails as a whole. Past this the
 * work belongs to the transaction stream (#121), which is not built — so the
 * cap is deliberately visible rather than a silent truncation: the response
 * reports outcomes only for what it acted on, and the operator sees the count.
 */
const BULK_SELECTION_CAP = 500;

/**
 * Run a `collection`-bound verb over a selection, reporting **per row**.
 *
 * The response is a plain `BulkOutcome[]` rather than an entity envelope: what
 * comes back is not a record, and dressing it as one would mean inventing an
 * entity for "the result of retiring some brands". A row that failed is `200`
 * data — the *request* succeeded, and only some of the rows did not.
 */
export const retireRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  { retired }: { retired: boolean },
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = (yield* request.json) as { selection?: unknown };

    // Read rather than cast. The body is untrusted and decides which rows a
    // write touches, and a `Set` does not survive JSON — so the wire form is
    // arrays and `readWireSelection` is what turns it back, rejecting anything
    // that is not a selection instead of defaulting to one.
    const selection = readWireSelection<T>(body.selection);
    if (!selection) {
      return yield* HttpServerResponse.json(
        {
          error: 'invalid request body',
          code: 'invalidBody',
          detail:
            'A bulk request carries a `selection` in `ids` or `matching` mode.',
        },
        { status: 400 },
      );
    }

    const ids = yield* resolveSelection(entityConstructor, selection);

    const outcomes = yield* retireReferences.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(RetireReferenceInputTag, { ids, retired }),
    );

    return yield* HttpServerResponse.json({
      meta: {
        type: 'bulkOutcome',
        entity: envelopeEntityName(entityConstructor),
      },
      data: outcomes,
    });
  }).pipe(Effect.catchAll(serverError));

/**
 * Guard a declared verb with the permission that verb derives.
 *
 * `permissionForUseCase` rather than `permissionForEntity`: the whole point of
 * ADR 0026 is that `retire` is not a shape of `write`, so it carries its own
 * third segment and its own grant.
 */
export const guardedUseCase = <A, E, R>(
  permission: Permission,
  route: Effect.Effect<A, E, R>,
) => requirePermission(permission)(() => route);
