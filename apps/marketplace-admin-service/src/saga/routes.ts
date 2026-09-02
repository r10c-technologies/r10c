import { HttpRouter, HttpServerResponse } from '@effect/platform';
import {
  TransactionStoreTag,
  TransactionStreamHubTag,
} from '@r10c/entifix-transactions';
import { makeEnvelope } from '@r10c/entifix-ts-core';
import {
  type RequestPrincipal,
  requirePrincipal,
  sseResponse,
} from '@r10c/shells-effect-service';
import { Effect, Stream } from 'effect';

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', detail: String(error) },
    { status: 500 },
  );

/**
 * A record the caller may not read is indistinguishable from one that is not
 * there.
 *
 * `403` would make the endpoint an oracle: a caller could enumerate other
 * tenants' transaction ids by the status code alone, and a transaction id is a
 * client-minted UUID that is also the entity's primary key. The same reasoning
 * `entityMetadataRoute` applies to an entity the caller may not see.
 */
const notFound = HttpServerResponse.json(
  { message: 'transaction not found' },
  { status: 404 },
);

/**
 * `GET /api/transaction/:id` — the record a client polls after its `202`.
 *
 * Scoped to the principal's organization. Until ADR 0036 it was unauthenticated
 * and unscoped, answering any id to anyone: the `saga` store is control-plane
 * and single-partition, so it holds every organization's records by design and
 * isolation here has to be a filter (#194).
 */
const byIdRoute = requirePrincipal((principal: RequestPrincipal) =>
  Effect.gen(function* () {
    const store = yield* TransactionStoreTag;
    const params = yield* HttpRouter.params;
    const record = yield* store.get(params.id ?? '');
    // Fails closed on a record written before `organizationId` existed: it
    // belongs to nobody rather than to everybody.
    if (
      record === undefined ||
      record.organizationId !== principal.organizationId
    ) {
      return yield* notFound;
    }
    return yield* HttpServerResponse.json(
      makeEnvelope('transactionEvent', record.entity, record),
    );
  }),
).pipe(Effect.catchAll(serverError));

/**
 * `GET /api/transaction/events` — the same facts as the route above, pushed
 * instead of polled (ADR 0036).
 *
 * Server-sent events rather than a WebSocket: the browser reaches this through
 * the app's existing same-origin proxy, so the `httpOnly` cookie flows exactly
 * as it does for every other call and no second class of bearer token has to be
 * handed to client JavaScript.
 *
 * A caller with no organization gets an **empty** stream rather than a `409`.
 * The connection is legitimate — an operator or a buyer holds one — there is
 * simply nothing tenant-scoped to send them, and failing here would make the
 * workspace unusable for a vendor who has not picked an organization yet.
 */
const eventsRoute = requirePrincipal((principal: RequestPrincipal) =>
  Effect.gen(function* () {
    const hub = yield* TransactionStreamHubTag;
    return sseResponse(
      principal.organizationId === undefined
        ? Stream.empty
        : hub.subscribe(principal.organizationId),
      { expiresAt: principal.expiresAt },
    );
  }),
).pipe(Effect.catchAll(serverError));

/**
 * The `transaction` slice's read surface, mounted by the host router.
 *
 * These are the routes the catalog's own `202` points clients at. Now that both
 * slices share a process they answer on the same origin, which is why the
 * accepted-transaction link is a relative href — the client already knows the
 * origin, and a slice that moves out again changes its deployment, not the
 * contract.
 *
 * `GET /api/transaction` — the unfiltered list of every organization's
 * transactions — is **gone**, not scoped. Nothing called it, and a readable
 * index of what every vendor is creating and what is failing is a surface worth
 * removing rather than filtering (#194).
 *
 * `/events` must stay a **literal**. It resolves before `/:id` because
 * `find-my-way-ts` prefers a static segment, but registering it as part of a
 * parametric pattern would put it behind the by-id handler with
 * `id === "events"` — the inverse of the `$metadata` collision ADR 0026 hit,
 * and just as invisible.
 *
 * There is deliberately no `/api/config` here: the host already serves one, and
 * two `/api/config` routes in one router is the kind of duplication a merge is
 * supposed to remove rather than carry forward.
 */
export const sagaRoutes = <E, R>(router: HttpRouter.HttpRouter<E, R>) =>
  router.pipe(
    HttpRouter.get('/api/transaction/events', eventsRoute),
    HttpRouter.get('/api/transaction/:id', byIdRoute),
  );
