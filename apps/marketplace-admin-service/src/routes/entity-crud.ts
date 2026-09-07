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
  type OfferingTransition,
  ProductOffering,
  transitionOffering,
  TransitionOfferingInputTag,
} from '@r10c/business-ts-product-configuration-management';
import {
  acceptTransaction,
  CommandTag,
  completeTransaction,
  EventBusTag,
  EventSourceTag,
  readCommandEnvelope,
  SequenceServiceTag,
  TransactionHandlerTag,
  TransactionOutboxTag,
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
  EntifixError,
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
} from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { requireOrganization } from '@r10c/shells-effect-service';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import {
  type CatalogHandlerOptions,
  makeCatalogTransactionHandler,
} from '../catalog-transaction-handler';
import { drainOutbox, OutboxMaxAttempts } from '../outbox/relay';
import { ensureOutboxIndexes, makeMongoOutbox } from '../outbox/store';

/**
 * The generic entity CRUD and the tenant guard every catalog route module in
 * this service composes.
 *
 * Extracted so each entity gets its own file: a corner case on one entity — a
 * create that must go through the saga rather than a plain save, say — is a
 * change to that entity's module rather than an `if` inside a shared handler.
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
 * Generic create/update route. The request body is an envelope, and so is the
 * response: it carries the entity as *stored*, which is how a create learns the
 * id the adapter minted for it.
 *
 * On update the URL is authoritative — the id from the path overrides whatever
 * the body claimed, so a record cannot be renamed by editing its payload.
 *
 * `prepare` is the same rule generalized to a member. A **server-owned but
 * client-visible** member must not be `@accessor({ readonly })` — that flag
 * drops it from deserialization too, so the browser would never see it either —
 * so it stays writable and the route overwrites it, exactly as the id above is
 * overwritten from the path. Without that, a member a use-case verb guards is
 * settable through this route by anyone holding plain `write`, and the verb's
 * own permission is decoration.
 */
export const saveRoute = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  {
    fromParams,
    prepare,
  }: {
    fromParams: boolean;
    // The requirement is stated rather than erased: a `prepare` that reads the
    // stored record goes through `makeMongoRepository`, whose adapter needs the
    // configuration store — the same requirement every other route here already
    // lets flow out to the composition root.
    prepare?: (
      entity: T,
      db: Db,
    ) => Effect.Effect<void, EntifixError, ConfigurationRepositoryTag>;
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

    if (prepare) {
      yield* prepare(entity, db);
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
 * the service runs the accept phase (validate -> claim -> lock) synchronously,
 * answers `202` with the transaction id, and forks the execute phase as a
 * daemon. The client polls the saga tracker for the outcome.
 *
 * **The client mints the transaction id** (ADR 0028) and sends a `command`
 * envelope, rather than an entity envelope the service turns into a command.
 * That is what lets the browser render the created record before the response
 * arrives — the id is also the stored entity's id — and what makes the id an
 * idempotency key. There is no server-side fallback that generates one: a
 * command without a valid id is a `400`, because a caller who omits it silently
 * loses retry safety while appearing to succeed.
 */
export const createTransactionRoute = <
  T extends Entity & { code?: string; name?: string },
>(
  entityConstructor: EntityConstructor<T>,
  options: CatalogHandlerOptions,
  organizationId: string,
) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = yield* MongoDatabaseTag;
    const store = yield* ConfigurationRepositoryTag;
    const sequence = yield* SequenceServiceTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;

    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    // Stamped from the verified token, never read from the body —
    // `readCommandEnvelope` drops whatever the caller sent under this name. It
    // is what every event this transaction emits is scoped by on the reactive
    // stream, so a caller able to set it could address another tenant's
    // connections (ADR 0036).
    const command = {
      ...(yield* readCommandEnvelope(body)),
      organizationId,
    };
    const { transactionId } = command;

    // Tenant databases appear on first write, so the indexes are ensured per
    // handle rather than at boot. The unique one is what enforces idempotency,
    // so it must exist before the first claim, not eventually.
    yield* ensureOutboxIndexes(db);
    const outbox = makeMongoOutbox(db);

    const source = yield* EventSourceTag;
    const handler = makeCatalogTransactionHandler(
      client,
      db,
      store,
      sequence,
      entityConstructor,
      options,
      source,
    );

    const accepted = yield* acceptTransaction().pipe(
      Effect.provideService(CommandTag, command),
      Effect.provideService(TransactionHandlerTag, handler),
      Effect.provideService(TransactionOutboxTag, outbox),
    );

    if (accepted.status === 'accepted') {
      // Execute phase — forked past the 202 so the request returns immediately.
      // The fast half of the relay runs after it: the request already holds this
      // tenant's handle, so the normal case reaches the bus with the latency it
      // had before the outbox existed. The sweep only covers what this misses.
      yield* completeTransaction(accepted.handles).pipe(
        Effect.provideService(CommandTag, command),
        Effect.provideService(TransactionHandlerTag, handler),
        Effect.provideService(TransactionOutboxTag, outbox),
        Effect.andThen(
          Effect.ignore(
            drainOutbox(outbox, bus, {
              maxAttempts,
              database: db.databaseName,
            }),
          ),
        ),
        Effect.forkDaemon,
      );
    }
    // A duplicate claim is a *retry*, so it gets the first command's answer:
    // same `202`, same status link, nothing executed a second time. A `409`
    // here would make the safe thing to do — resend — look like a conflict.

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
export const guarded = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
  route: (organizationId: string) => Effect.Effect<A, E, R>,
) =>
  requireOrganization(permissionForEntity(entityConstructor, action))(
    organizationId =>
      Effect.gen(function* () {
        const resolver = yield* TenantDatabaseResolverTag;
        // The tag is datastore-agnostic (`TenantDatabaseResolver<unknown>`) so
        // that a Postgres adapter can satisfy it later; this service knows it
        // provided the Mongo one, which is what the cast records.
        const db = (yield* resolver.forOrganization(organizationId)) as Db;
        return yield* route(organizationId).pipe(
          Effect.provideService(MongoDatabaseTag, db),
        );
      }).pipe(
        // Each route already maps its own failures; what can still fail here is
        // resolving the tenant handle.
        Effect.catchAll(serverError),
      ),
  );

/**
 * Guard a declared verb with the permission that verb derives, and bind the
 * request to the caller's organization database.
 *
 * The tenant half is what makes this a different helper from
 * `marketplace-service`'s `guardedUseCase`, which is built on
 * `requirePermission` alone: that service's stores are `partitioning: 'single'`,
 * this one's `catalog` is one Mongo database per organization. Everything else
 * is {@link guarded} — the permission is simply supplied rather than derived
 * from an entity and an `Action`.
 *
 * `permissionForUseCase` rather than `permissionForEntity`, for ADR 0026's
 * reason: `publish` is not a shape of `write`, so it carries its own third
 * segment and its own grant, and a route that said `write` here would let
 * anyone who can edit a draft put it in front of buyers.
 */
export const guardedUseCase = <A, E, R>(
  permission: Permission,
  route: (organizationId: string) => Effect.Effect<A, E, R>,
) =>
  requireOrganization(permission)(organizationId =>
    Effect.gen(function* () {
      const resolver = yield* TenantDatabaseResolverTag;
      const db = (yield* resolver.forOrganization(organizationId)) as Db;
      return yield* route(organizationId).pipe(
        Effect.provideService(MongoDatabaseTag, db),
      );
    }).pipe(Effect.catchAll(serverError)),
  );

/**
 * Move one offering along its lifecycle.
 *
 * The rule is the domain's (`offeringStatusAfter`); this route only supplies
 * the id from the path and the repository, and turns the domain's refusal into
 * a status code. **`409`, not `400`**: the request is well-formed and the
 * caller is allowed to make it — what is wrong is the *state of the record*,
 * which is exactly the distinction a conflict status carries. A `400` would
 * tell a vendor to fix their request when there is nothing in it to fix.
 *
 * The response is an ordinary entity envelope holding the record as stored, so
 * the browser re-renders the new status from the write's own answer rather than
 * re-reading it.
 */
export const transitionOfferingRoute = (transition: OfferingTransition) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;
    const id = params.id as EntityId;

    const offering = yield* transitionOffering.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, ProductOffering),
      ),
      Effect.provideService(TransitionOfferingInputTag, { id, transition }),
    );

    const key = envelopeEntityName(ProductOffering);
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(
        ProductOffering,
        offering,
        entityLinks(key, offering.id),
      ),
    );
  }).pipe(
    Effect.catchTag('IllegalOfferingTransition', failure =>
      HttpServerResponse.json(
        {
          error: 'illegal offering transition',
          code: failure.code,
          detail: `An offering in '${failure.from}' cannot be ${failure.transition}ed.`,
        },
        { status: 409 },
      ),
    ),
    Effect.catchAll(serverError),
  );

/**
 * Keeps an offering's `status` out of the hands of the generic write path.
 *
 * ⚠️ Without this the two declared verbs are **decoration**: `status` is an
 * ordinary writable member, so anyone holding
 * `product-configuration-management:product-offering:write` could `POST` an
 * offering that is already `published`, or `PUT` one straight from `draft` to
 * `published`, and never touch the route that checks `…:publish`. The lifecycle
 * would be a text box with four suggestions, which is precisely what
 * [ADR 0047](../../../../docs/adr/0047-authoring-an-offering-and-the-publish-verb.md)
 * refused to build.
 *
 * A create always starts at `draft`. An update takes the **stored** value,
 * because only `transitionOffering` may move it — an unreadable record falls
 * through to the save, which then fails on its own terms rather than being
 * reported here as a status problem.
 */
export const preserveOfferingStatus = (
  offering: ProductOffering,
  db: Db,
): Effect.Effect<void, EntifixError, ConfigurationRepositoryTag> =>
  Effect.gen(function* () {
    if (offering.id == null) {
      offering.status = 'draft';
      return;
    }

    const stored = yield* makeMongoRepository(db, ProductOffering)
      .get<ProductOffering>(offering.id)
      .pipe(Effect.option);

    if (stored._tag === 'Some') {
      offering.status = stored.value.status;
    }
  });
