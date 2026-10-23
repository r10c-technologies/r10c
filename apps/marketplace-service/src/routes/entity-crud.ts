import {
  type Action,
  type Permission,
  permissionForEntity,
} from '@entifix/authz';
import {
  deleteUCFactory,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  EntityTag,
  getUCFactory,
  loadAllUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@entifix/business';
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
} from '@entifix/core';
import { makeMongoRepository, MongoDatabaseTag } from '@entifix/mongo';
import { requirePermission } from '@entifix/service-shell';
import {
  RetireReferenceInputTag,
  retireReferences,
} from '@r10c/business-ts-catalog-reference';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

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
  }).pipe(Effect.catch(readError));

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
    Effect.catch(() =>
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
 * Every record of one entity in this slice's stores.
 *
 * Only ever asked for the vocabulary, which is operator-authored and bounded
 * by construction, so reading it whole is what a rule over the whole tree
 * needs rather than a scan to be wary of.
 */
const loadEvery = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    return yield* loadAllUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityLoadRequestTag, {}),
    );
  });

export interface SaveRouteOptions<T extends Entity> {
  readonly fromParams: boolean;
  /**
   * A rule over the whole store a save must pass, answering a code for a
   * `409` or `undefined`. Given the record as it would be saved and every
   * stored record, because the rules that need it (a category tree's) are
   * about where the record sits among the others.
   */
  readonly refuse?: (entity: T, all: readonly T[]) => string | undefined;
}

export const saveRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  { fromParams, refuse }: SaveRouteOptions<T>,
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

    if (refuse !== undefined) {
      const refused = refuse(entity, yield* loadEvery(entityConstructor));
      if (refused !== undefined) {
        return yield* HttpServerResponse.json(
          { error: 'the record cannot be saved here', code: refused },
          { status: 409 },
        );
      }
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
  }).pipe(Effect.catch(writeError));

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
  }).pipe(Effect.catch(serverError));

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
export interface RetireRouteOptions<T extends Entity> {
  readonly retired: boolean;
  /**
   * Builds the per-row rule a run applies, from every stored record and the
   * ids selected. A category may not be retired under an active child nor
   * restored under a retired parent; a brand passes none.
   */
  readonly guard?: (
    all: readonly T[],
    ids: readonly EntityId[],
    retired: boolean,
  ) => (record: T) => string | undefined;
}

export const retireRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  { retired, guard }: RetireRouteOptions<T>,
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
    const refuse =
      guard === undefined
        ? undefined
        : guard(yield* loadEvery(entityConstructor), ids, retired);

    const outcomes = yield* retireReferences.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(RetireReferenceInputTag, {
        ids,
        retired,
        // The use case types its rows as any retirable record; this route
        // knows they are `T`, because it is the one that read them.
        refuse: refuse as ((record: unknown) => string | undefined) | undefined,
      }),
    );

    return yield* HttpServerResponse.json({
      meta: {
        type: 'bulkOutcome',
        entity: envelopeEntityName(entityConstructor),
      },
      data: outcomes,
    });
  }).pipe(Effect.catch(serverError));

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
