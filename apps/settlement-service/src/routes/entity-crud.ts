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
  type FilterGroup,
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
  type RequestPrincipal,
  requirePermission,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/**
 * The generic reads and the one write every route module in this service
 * composes.
 *
 * ⚠️ **No tenant guard here, and that is the plane rather than an omission.**
 * The `settlement` store is **control** plane and single-partitioned: one
 * database, named at boot. stock-service and sales-service resolve a
 * per-organization handle inside every request; there is no handle to choose
 * here, so a route is guarded by a permission and narrowed by a predicate
 * (`docs/_shared/planes.md`).
 *
 * ⚠️ **Unlike payment-service, the reads *are* scoped**, and that is the whole
 * reason a grant exists at all. A `Payment` carries neither a buyer nor a vendor
 * to key a predicate on, so ADR 0054 withheld the read from every role but
 * `admin` and recorded the residual. Every record here carries `vendorId`, so
 * the predicate is available — and it has to be, because a commission rate is a
 * negotiated term and a competitor learning it is an injury with no undo. See
 * `settlement-scope.ts`.
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

/** The write mirror of {@link readError}. */
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
 * The HATEOAS affordances for a single record. Only this service knows its own
 * route surface, so links are filled in here rather than by the envelope
 * builders in `core`.
 *
 * ⚠️ **`update` is advertised per entity, not for all of them.** An `Agreement`
 * is authored and re-negotiated; a `CommissionEntry`, a `SettlementRun` and a
 * `VendorPayout` are produced by a fold, and a client that rendered a Save from
 * an advertised affordance would be offering to rewrite a ledger.
 */
const entityLinks = (
  key: string,
  id: EntityId,
  updatable: boolean,
): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}/${String(id)}`, method: 'GET' },
  { rel: 'list', href: `/api/${key}`, method: 'GET' },
  ...(updatable
    ? [
        {
          rel: 'update',
          href: `/api/${key}/${String(id)}`,
          method: 'PUT',
        } as const,
      ]
    : []),
];

const collectionLinks = (key: string): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${key}`, method: 'GET' },
];

/**
 * Generic list route for an entity, backed by Mongo + the entifix load UC.
 *
 * `scopeFilter` is the route's own predicate, and it is **conjoined** rather
 * than substituted: `parseLoadRequestParams` collapses the caller's whole
 * expression into one element of `filtering`, and the Mongo translator `$and`s
 * every top-level element — so an added element can only narrow, and no `or` in
 * a query string can escape it. Building the same thing by concatenating rsql
 * would not have that property.
 *
 * ⚠️ The envelope echoes the request back, so the predicate is visible in the
 * response body. That discloses the caller's own scope to the caller, which is
 * what they already know.
 */
export const listRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  scopeFilter?: FilterGroup<T>,
) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const parsed = yield* readLoadRequest(entityConstructor);
    const request =
      scopeFilter === undefined
        ? parsed
        : ({
            ...parsed,
            filtering: [...(parsed.filtering ?? []), scopeFilter],
          } as EntityLoadRequest);
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

/**
 * An empty page, answered without reading anything.
 *
 * The response for a caller whose own records cannot be identified — a vendor
 * session with no organization, or a buyer, who is party to nothing here. It is
 * a page and not a `403`, because holding the read grant and owning no records
 * are different facts, and the second one is not an error.
 *
 * The request is still parsed, so a malformed `rsql` is still the `400` it would
 * be for anybody else: whether a query is well-formed must not depend on who
 * asked.
 */
export const emptyPageRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
) =>
  Effect.gen(function* () {
    const request = yield* readLoadRequest(entityConstructor);
    return yield* HttpServerResponse.json(
      makeEntityPageEnvelope(
        entityConstructor,
        { items: [], total: 0, request },
        collectionLinks(envelopeEntityName(entityConstructor)),
      ),
    );
  }).pipe(Effect.catchAll(readError));

/** The `404` a missing record and an out-of-scope one both answer with. */
const notFound = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  // The entity's own key, not a hardcoded English name passed at the call site:
  // the client translates `errors:notFound` and already knows how to render
  // that entity's label from its metadata.
  HttpServerResponse.json(
    {
      message: 'not found',
      code: 'notFound',
      entity: extractMetaEntity(entityConstructor).key,
    },
    { status: 404 },
  );

/**
 * Generic single-record route by `:id`.
 *
 * `inScope` is checked **after** the load rather than folded into it, because
 * `id` is the one member that is neither sortable nor filterable and so cannot
 * be queried at all. A record outside the caller's scope answers the same `404`
 * an absent one does: a `403` here would confirm to a competitor that the vendor
 * they named has an agreement.
 */
export const byIdRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  inScope: (entity: T) => boolean = () => true,
  updatable = false,
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
    if (!inScope(entity)) {
      return yield* Effect.fail(new EntifixBuildError('out of scope'));
    }
    const key = envelopeEntityName(entityConstructor);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(
        entityConstructor,
        entity,
        entityLinks(key, params.id, updatable),
      ),
    );
  }).pipe(Effect.catchAll(() => notFound(entityConstructor)));

/** A by-id read for a caller who can own no record: the same `404`, no load. */
export const notFoundRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
) => notFound(entityConstructor);

/**
 * Generic save route. `POST` mints an id, `PUT` takes it from the path.
 *
 * ⚠️ **`fromParams` is what stops a `PUT` renaming a record.** The route owns
 * the id the way order-service's place route owns its own: a body claiming a
 * different one is overwritten rather than honoured, so `PUT /api/agreement/a`
 * cannot write agreement `b`.
 */
export const saveRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  {
    fromParams,
    validate,
  }: {
    fromParams: boolean;
    /**
     * A check the deserializer does not make.
     *
     * ⚠️ **Metadata is not a server-side validator.** `readEntityEnvelope` sets
     * members from the body and enforces only what the accessor's type demands;
     * a rate table keyed by a channel type nobody sells through, or a negative
     * commission, deserializes perfectly well. Both are refused here because
     * both would price a real invoice.
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
      makeEntityEnvelope(
        entityConstructor,
        saved,
        entityLinks(key, saved.id, true),
      ),
    );
  }).pipe(Effect.catchAll(writeError));

/**
 * Guard a control-plane route: check the permission the entity derives, and
 * nothing else.
 *
 * ⚠️ **Deliberately not `requireOrganization`.** This store is control plane, so
 * there is no handle to resolve and `409 noActiveOrganization` would be a
 * plausible-looking error about a tenancy the store does not have. Narrowing to
 * the caller is the scope's job, and a caller with no organization gets an empty
 * page rather than a refusal — see `settlement-scope.ts`.
 */
export const guarded = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: (principal: RequestPrincipal) => Effect.Effect<A, E, R>,
) => requirePermission(permissionForEntity(entityConstructor, action))(route);
