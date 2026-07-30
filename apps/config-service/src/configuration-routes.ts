import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { type Action, permissionForEntity } from '@r10c/business-ts-authz';
import { Configuration } from '@r10c/business-ts-configuration';
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
  type EntityId,
  type EntityLoadRequest,
  envelopeEntityName,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
} from '@r10c/entifix-ts-core';
import { makeSqlRepository } from '@r10c/entifix-ts-sql-client';
import {
  type RequestPrincipal,
  requirePermission,
} from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/** The entity's own key, which is also its table name and its route segment. */
const KEY = envelopeEntityName(Configuration);

/**
 * Reads the load request from the query string: `rsql` (filtering), `sort`,
 * `page` and `pageSize`, validated against the entity's own metadata by the
 * shared codec — so a client can only name members the entity declared
 * filterable/sortable. `value` is neither, which is what keeps a caller from
 * probing a credential one guess at a time.
 */
const readLoadRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const search = new URL(request.url, 'http://localhost').searchParams;
  return yield* Effect.try({
    try: () =>
      parseLoadRequestParams(
        Configuration,
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

const readError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid query', code: 'invalidQuery', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

const writeError = (error: unknown) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        { error: 'invalid request body', code: 'invalidBody', detail: error.message },
        { status: 400 },
      )
    : serverError(error);

const entityLinks = (id: EntityId): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${KEY}/${String(id)}`, method: 'GET' },
  { rel: 'list', href: `/api/${KEY}`, method: 'GET' },
  { rel: 'update', href: `/api/${KEY}/${String(id)}`, method: 'PUT' },
  { rel: 'delete', href: `/api/${KEY}/${String(id)}`, method: 'DELETE' },
];

const collectionLinks = (): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/${KEY}`, method: 'GET' },
  { rel: 'create', href: `/api/${KEY}`, method: 'POST' },
];

/** The repository the use-cases run against — the entifix relational adapter. */
const repository = Effect.map(SqlClient.SqlClient, sql =>
  makeSqlRepository(sql, Configuration),
);

/**
 * Blanks a secret's value on the way out.
 *
 * The single read-side choke point. `undefined` is dropped by the serializer, so
 * the envelope simply has no `value` for a secret row and `isSecret: true` is what
 * tells the client to render "unchanged" rather than "empty". Nothing downstream
 * has to remember to redact.
 */
const withoutSecretValues = (rows: readonly Configuration[]): void => {
  for (const row of rows) {
    if (row.isSecret === true) {
      row.value = undefined;
    }
  }
};

/** The stored row behind an id, as the write rules need to see it. */
interface StoredRow {
  readonly service: string;
  readonly group_name: string;
  readonly key: string;
  readonly value: string;
  readonly is_secret: boolean;
}

const findStored = (id: EntityId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<StoredRow>`
      SELECT service, group_name, key, value, is_secret
      FROM configuration WHERE id = ${String(id)}
    `;
    return rows[0];
  });

/**
 * Appends to the append-only audit log.
 *
 * A secret's plaintext is never recorded on either side — `secret_changed` says
 * only that it moved, which is what an operator actually needs and is the one
 * thing a log of credentials must not become.
 */
const audit = (entry: {
  readonly configurationId: EntityId;
  readonly service: string;
  readonly groupName: string;
  readonly key: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly oldValue?: string;
  readonly newValue?: string;
  readonly isSecret: boolean;
  readonly principal: RequestPrincipal;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO configuration_audit ${sql.insert({
        configuration_id: String(entry.configurationId),
        service: entry.service,
        group_name: entry.groupName,
        key: entry.key,
        action: entry.action,
        old_value: entry.isSecret ? null : (entry.oldValue ?? null),
        new_value: entry.isSecret ? null : (entry.newValue ?? null),
        secret_changed:
          entry.isSecret && entry.newValue !== undefined && entry.newValue !== '',
        actor_id: entry.principal.userId,
        actor_email: entry.principal.subject,
      })}
    `;
  });

/** `GET /api/configuration` — the RSQL list, with secrets blanked. */
const listRoute = Effect.gen(function* () {
  const request = yield* readLoadRequest;
  const page = yield* loadUCFactory<Configuration>().pipe(
    Effect.provideServiceEffect(EntityRepositoryTag, repository),
    Effect.provideService(EntityLoadRequestTag, request),
  );

  withoutSecretValues(page.items);

  return yield* HttpServerResponse.json(
    makeEntityPageEnvelope(Configuration, page, collectionLinks()),
  );
}).pipe(Effect.catchAll(readError));

/** `GET /api/configuration/:id`. */
const byIdRoute = Effect.gen(function* () {
  const params = yield* HttpRouter.params;
  const row = yield* getUCFactory<Configuration>().pipe(
    Effect.provideServiceEffect(EntityRepositoryTag, repository),
    Effect.provideService(EntityIdTag, params.id),
  );

  withoutSecretValues([row]);

  return yield* HttpServerResponse.json(
    makeEntityEnvelope(Configuration, row, entityLinks(params.id)),
  );
}).pipe(
  Effect.catchAll(() =>
    HttpServerResponse.json(
      { message: 'not found', code: 'notFound', entity: KEY },
      { status: 404 },
    ),
  ),
);

/**
 * Create/update. `fromParams` makes the URL authoritative on update, so a record
 * cannot be re-pointed by editing its payload — the same rule the catalog's save
 * route applies to the id.
 *
 * Three things the route owns and the adapter must not:
 *
 * 1. **The audit stamps.** `updatedAt`/`updatedBy` are overwritten from the
 *    verified principal, so a client cannot forge them. They are ordinary
 *    members rather than `readonly` metadata because `readonly` would drop them
 *    from *both* directions and the UI needs to read them.
 * 2. **Write-only secrets.** An absent or empty value on a row that is already
 *    secret leaves the stored value untouched, so a form that renders the field
 *    blank does not wipe a credential on save.
 * 3. **Clearing `isSecret` requires a new value.** Otherwise flipping the flag
 *    off would make the next read return the plaintext — turning
 *    `config:configuration:write` into a read of every credential in the fleet,
 *    which is exactly the escalation the write-only rule exists to prevent.
 */
const saveRoute = (
  principal: RequestPrincipal,
  { fromParams }: { fromParams: boolean },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const incoming = yield* readEntityEnvelope(Configuration, body);

    if (fromParams) {
      const params = yield* HttpRouter.params;
      incoming.id = params.id;
    }

    const stored =
      incoming.id === undefined ? undefined : yield* findStored(incoming.id);

    const wasSecret = stored?.is_secret ?? false;
    const incomingValue = incoming.value;
    const hasNewValue = incomingValue !== undefined && incomingValue !== '';

    if (wasSecret && incoming.isSecret === false && !hasNewValue) {
      return yield* HttpServerResponse.json(
        {
          error: 'clearing the secret flag requires a new value',
          code: 'secretRequiresValue',
        },
        { status: 400 },
      );
    }

    // Keep the stored credential when the form submitted the field untouched.
    if (wasSecret && !hasNewValue) {
      incoming.value = stored?.value;
    }

    incoming.updatedAt = new Date();
    incoming.updatedBy = principal.subject;

    const saved = yield* sql.withTransaction(
      Effect.gen(function* () {
        const result = yield* saveUCFactory<Configuration>().pipe(
          Effect.provideServiceEffect(EntityRepositoryTag, repository),
          Effect.provideService(EntityTag, incoming),
        );

        yield* audit({
          configurationId: result.id,
          service: result.service ?? stored?.service ?? '',
          groupName: result.groupName ?? stored?.group_name ?? '',
          key: result.key ?? stored?.key ?? '',
          action: stored === undefined ? 'create' : 'update',
          oldValue: stored?.value,
          newValue: incomingValue,
          isSecret: result.isSecret ?? wasSecret,
          principal,
        });

        return result;
      }),
    );

    withoutSecretValues([saved]);

    return yield* HttpServerResponse.json(
      makeEntityEnvelope(Configuration, saved, entityLinks(saved.id)),
    );
  }).pipe(Effect.catchAll(writeError));

/**
 * Delete. The row is read first so the audit entry can name what was removed —
 * after the delete there is nothing left to describe it.
 */
const deleteRoute = (principal: RequestPrincipal) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const params = yield* HttpRouter.params;
    const stored = yield* findStored(params.id);

    if (stored === undefined) {
      return yield* HttpServerResponse.json(
        { message: 'not found', code: 'notFound', entity: KEY },
        { status: 404 },
      );
    }

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* deleteUCFactory<Configuration>().pipe(
          Effect.provideServiceEffect(EntityRepositoryTag, repository),
          Effect.provideService(EntityIdTag, params.id),
        );

        yield* audit({
          configurationId: params.id,
          service: stored.service,
          groupName: stored.group_name,
          key: stored.key,
          action: 'delete',
          oldValue: stored.value,
          isSecret: stored.is_secret,
          principal,
        });
      }),
    );

    // An envelope rather than a bare `204`: the entifix fetch client always parses
    // the response as JSON.
    return yield* HttpServerResponse.json({
      meta: { type: 'entity', entity: KEY, links: collectionLinks() },
      data: { id: params.id },
    });
  }).pipe(Effect.catchAll(serverError));

/**
 * Guard a route with the permission the entity itself declares. Unlike the
 * catalog's equivalent this threads the principal through, because every write
 * here is audited and the actor is part of the record.
 */
const guarded = <A, E, R>(
  action: Action,
  route: (principal: RequestPrincipal) => Effect.Effect<A, E, R>,
) => requirePermission(permissionForEntity(Configuration, action))(route);

/**
 * The configuration CRUD, behind `config:configuration:*`.
 *
 * Writes are a plain save, not the CQRS/saga path the catalog uses for creates:
 * there is no cross-service invariant to coordinate here, and an operator editing
 * a connection string wants a synchronous answer rather than a transaction id to
 * poll.
 */
export const configurationRoutes = <E, R>(
  router: HttpRouter.HttpRouter<E, R>,
) =>
  router.pipe(
    HttpRouter.get(`/api/${KEY}`, guarded('read', () => listRoute)),
    HttpRouter.get(`/api/${KEY}/:id`, guarded('read', () => byIdRoute)),
    HttpRouter.post(
      `/api/${KEY}`,
      guarded('write', principal => saveRoute(principal, { fromParams: false })),
    ),
    HttpRouter.put(
      `/api/${KEY}/:id`,
      guarded('write', principal => saveRoute(principal, { fromParams: true })),
    ),
    HttpRouter.del(`/api/${KEY}/:id`, guarded('delete', deleteRoute)),
  );
