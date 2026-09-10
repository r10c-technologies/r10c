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
  OfferingPriceRepositoryTag,
  OfferingSpecificationRepositoryTag,
  type OfferingTransition,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
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
  EntifixConnError,
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
  serializeEntity,
} from '@r10c/entifix-ts-core';
import {
  drainOutbox,
  ensureOutboxIndexes,
  makeMongoOutbox,
  makeMongoRepository,
  MongoClientTag,
  MongoDatabaseTag,
  OUTBOX_COLLECTION,
  outboxDocument,
  OutboxMaxAttempts,
} from '@r10c/entifix-ts-mongo-client';
import { requireOrganization } from '@r10c/shells-effect-service';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import {
  type CatalogHandlerOptions,
  makeCatalogTransactionHandler,
} from '../catalog-transaction-handler';

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
          type: 'transactionAccepted',
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
 * Move one offering along its lifecycle, and announce where it landed — in one
 * Mongo transaction.
 *
 * The rule is the domain's (`offeringStatusAfter`) and so is the decision
 * (`transitionOffering`); what lives here is the **commit**, because a driver
 * session may not enter the framework-free `EntityRepository` or
 * `TransactionOutbox` ports and ADR 0028 rejected threading one through by
 * name. This is the same shape `makeCatalogTransactionHandler.execute` uses for
 * its `completed` entry: whoever holds the session writes both documents.
 *
 * ⚠️ **The status write and the event are one transaction or they are a lie.**
 * Written separately, a broker outage between them leaves the offering
 * `published` on the vendor's own screen and absent from the storefront
 * forever, with nothing to replay from — the exact failure the outbox exists to
 * remove. The relay's fast half then runs inline, so a publish normally reaches
 * the bus immediately rather than waiting out a 15s sweep.
 *
 * Two refusals, both **`409`, not `400`**: the request is well-formed and the
 * caller is allowed to make it — what is wrong is the *state of the record*,
 * which is exactly the distinction a conflict status carries. A `400` would
 * tell a vendor to fix their request when there is nothing in it to fix.
 *
 * The response is an ordinary entity envelope holding the record as stored, so
 * the browser re-renders the new status from the write's own answer rather than
 * re-reading it.
 */
export const transitionOfferingRoute = (
  transition: OfferingTransition,
  organizationId: string,
) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = yield* MongoDatabaseTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const source = yield* EventSourceTag;

    const params = yield* HttpRouter.params;
    const id = params.id as EntityId;

    const { offering, event } = yield* transitionOffering.pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, ProductOffering),
      ),
      Effect.provideService(
        OfferingPriceRepositoryTag,
        makeMongoRepository(db, ProductOfferingPrice),
      ),
      // The same tenant handle again, a third time. Three tags rather than three
      // uses of one, because one tag resolves to one value: the last provision
      // would answer every read, and a repository built for `ProductOffering`
      // deserializes a specification document into the wrong class instead of
      // failing.
      Effect.provideService(
        OfferingSpecificationRepositoryTag,
        makeMongoRepository(db, ProductSpecification),
      ),
      Effect.provideService(TransitionOfferingInputTag, {
        id,
        transition,
        // From the verified principal, never a body member: this decides which
        // vendor a storefront row is attributed to, and once orders exist, who
        // is paid for it.
        vendorId: organizationId,
        source,
        at: new Date(),
      }),
    );

    // Tenant databases appear on first write, so the indexes are ensured per
    // handle rather than at boot. The unique one on `eventId` is what makes a
    // redelivered publication a duplicate rather than a second message, so it
    // must exist before the first insert and not eventually.
    yield* ensureOutboxIndexes(db);
    const outbox = makeMongoOutbox(db);

    const document = serializeEntity(ProductOffering, offering);

    yield* Effect.tryPromise({
      try: async () => {
        const session = client.startSession();
        try {
          // `withTransaction`, never a hand-rolled start/commit: an election
          // aborts an in-flight transaction with a `TransientTransactionError`
          // the *application* is expected to retry, and a single-node dev
          // replica set never raises one. Nothing non-transactional runs
          // inside — the event was built before this opened, so a retry
          // re-sends the same payload rather than stamping a new moment.
          await session.withTransaction(async () => {
            // `envelopeEntityName` is byte-identical to `makeMongoRepository`'s
            // own `collectionName` (`metaEntity.key ?? metaEntity.name`), so
            // this writes the collection the repository reads. Spelled through
            // the entity for that reason rather than as a literal.
            await db
              .collection(envelopeEntityName(ProductOffering))
              .replaceOne(
                { id: offering.id },
                { ...document, id: offering.id },
                { upsert: true, session },
              );
            await db
              .collection(OUTBOX_COLLECTION)
              .insertOne(outboxDocument(event), { session });
          });
        } finally {
          await session.endSession();
        }
      },
      catch: error =>
        new EntifixConnError(
          'Failed to commit the offering and its publication',
          error,
          { id: String(id), transition },
        ),
    });

    // Forked past the response, exactly as `createTransactionRoute` does: the
    // request already holds this tenant's handle, so the normal case reaches
    // the bus with the latency it had before the outbox existed, and the sweep
    // only covers what this misses. Ignored, because the entry is already
    // durable — a failure here delays delivery, it does not lose it.
    yield* Effect.forkDaemon(
      Effect.ignore(
        drainOutbox(outbox, bus, {
          maxAttempts,
          database: db.databaseName,
        }),
      ),
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
    Effect.catchTag('OfferingHasNoPrice', failure =>
      HttpServerResponse.json(
        {
          error: 'offering has no price',
          code: failure.code,
          detail:
            'An offering needs a price before it can reach the storefront: ' +
            'the published record carries an amount and a currency.',
        },
        { status: 409 },
      ),
    ),
    Effect.catchTag('OfferingHasNoSpecification', failure =>
      HttpServerResponse.json(
        {
          error: 'offering has no specification',
          code: failure.code,
          // The dangling id, because nothing enforces the reference and the
          // vendor cannot find it from the offering's own screen.
          detail:
            `This offering names specification '${failure.specificationId}', ` +
            'which no longer exists. The published record copies its name, ' +
            'description, brand and category.',
        },
        { status: 409 },
      ),
    ),
    Effect.catchAll(serverError),
  );

/**
 * Keeps an offering's **lifecycle pair** — `status` and `statusChangedAt` — out
 * of the hands of the generic write path.
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
 * ⚠️ **`statusChangedAt` is the second half and it is not decoration either.**
 * It is written by `transitionOffering` and read by the rebuild walk, so a `PUT`
 * that omits it blanks it and removes that offering from every future rebuild —
 * silently, with the record still reading `published` on the vendor's screen.
 * This is the fault [ADR 0049](../../../../docs/adr/0049-the-publication-snapshot-carries-what-the-storefront-renders.md)
 * recorded for `ProductSpecification.code`, which has no such hook; the answer
 * is the same one, and the name says `Lifecycle` rather than `Status` so the
 * next server-owned member is not left out of it.
 *
 * A create always starts at `draft` and carries **no** moment — nothing has been
 * decided about it yet, and the first transition stamps one. An update takes the
 * **stored** values, because only `transitionOffering` may move them; an
 * unreadable record falls through to the save, which then fails on its own terms
 * rather than being reported here as a status problem.
 */
export const preserveOfferingLifecycle = (
  offering: ProductOffering,
  db: Db,
): Effect.Effect<void, EntifixError, ConfigurationRepositoryTag> =>
  Effect.gen(function* () {
    if (offering.id == null) {
      offering.status = 'draft';
      offering.statusChangedAt = undefined;
      return;
    }

    const stored = yield* makeMongoRepository(db, ProductOffering)
      .get<ProductOffering>(offering.id)
      .pipe(Effect.option);

    if (stored._tag === 'Some') {
      offering.status = stored.value.status;
      offering.statusChangedAt = stored.value.statusChangedAt;
    }
  });
