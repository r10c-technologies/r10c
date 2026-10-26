import type {
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  EntifixBuildError,
  type EntifixEnvelopeLink,
  makeEntityEnvelope,
  readEntityEnvelope,
} from '@entifix/core';
import {
  COMMAND_ID_HEADER,
  type EntityRouteContext,
  type EntityRouteLinks,
  makeEntityRoutes,
  requireServiceCrossing,
  routeFailure,
  type ServiceCrossingTokenTag,
} from '@entifix/service-shell';
import {
  recordMovement,
  Reservation,
  type ReservationTtlSecondsTag,
  restoreStock,
  StockItem,
  StockLedgerTag,
  StockMovement,
  StockRefused,
  takeReservation,
} from '@r10c/business-ts-stock-management';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

/** What a host provides for {@link stockRoutes}. */
export type StockRouteServices =
  | EntityRepositoryFactoryTag
  | StockLedgerTag
  | ReservationTtlSecondsTag
  | TokenServiceTag
  | PolicyDecisionTag
  | ServiceCrossingTokenTag
  | ServiceCrossingPolicyTag;

/** What the two write overrides read, beyond what the derived routes need. */
type OverrideServices =
  | StockLedgerTag
  | ReservationTtlSecondsTag
  | HttpServerRequest.HttpServerRequest;

const commandIdOf = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers[COMMAND_ID_HEADER]?.trim() || undefined;

/** The per-organization store refuses a scope with none; the guards always name one. */
const organizationOf = (context: EntityRouteContext) =>
  context.organizationId as string;

const failed = (error: unknown) =>
  error instanceof StockRefused
    ? HttpServerResponse.json(
        {
          error:
            error.code === 'inconsistentMovement'
              ? 'inconsistent movement'
              : 'invalid request body',
          code: error.code,
          detail: error.detail,
        },
        { status: 400 },
      )
    : error instanceof EntifixBuildError
      ? HttpServerResponse.json(
          {
            error: 'invalid request body',
            code: 'invalidBody',
            detail: error.message,
          },
          { status: 400 },
        )
      : routeFailure(error);

/** Back to the item a hold or a movement moved — the fold it explains. */
const stockItemLink = (offeringId: string): EntifixEnvelopeLink => ({
  rel: 'stock-item',
  href: `/api/stock-item?rsql=offeringId==${offeringId}`,
  method: 'GET',
});

const linksFor = (
  links: EntityRouteLinks,
  id: string,
  offeringId: string,
): EntifixEnvelopeLink[] => [
  ...links.record(id),
  ...links.collection(),
  stockItemLink(offeringId),
];

/**
 * `POST /api/reservation` — the platform → tenant crossing (ADR 0023): a
 * service token plus `reservation:write`, the organization named in a header,
 * and **no session**. A redelivered command answers `200` with the hold it
 * already took: `409` would read as "out of stock" to a dispatcher that cannot
 * tell the two apart, and a compensation would then release a hold it believes
 * was never taken.
 */
const take = (context: EntityRouteContext, links: EntityRouteLinks) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const reservation = yield* readEntityEnvelope(
      Reservation,
      yield* request.json,
    );
    const outcome = yield* takeReservation({
      organizationId: organizationOf(context),
      reservation,
      commandId: commandIdOf(request),
    });
    switch (outcome._tag) {
      case 'insufficient':
        // The request is well formed and conflicts with the current state.
        return yield* HttpServerResponse.json(
          {
            error: 'insufficient stock',
            code: 'insufficientStock',
            detail: `${String(reservation.quantity)} is more than is available of ${reservation.offeringId}`,
          },
          { status: 409 },
        );
      case 'replayed':
      case 'held': {
        const held = outcome.reservation;
        return yield* HttpServerResponse.json(
          makeEntityEnvelope(
            Reservation,
            held,
            linksFor(links, String(held.id), held.offeringId),
          ),
          { status: outcome._tag === 'held' ? 201 : 200 },
        );
      }
    }
  }).pipe(Effect.catch(failed));

/**
 * `POST /api/stock-movement` — a vendor's own ledger line, behind their
 * session. Append-only: there is no `PUT` and no `DELETE`, and a correction is
 * a new movement with `reason: 'adjustment'`.
 */
const record = (context: EntityRouteContext, links: EntityRouteLinks) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const movement = yield* readEntityEnvelope(
      StockMovement,
      yield* request.json,
    );
    const recorded = yield* recordMovement({
      organizationId: organizationOf(context),
      movement,
    });
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(
        StockMovement,
        recorded,
        linksFor(links, String(recorded.id), recorded.offeringId),
      ),
      { status: 201 },
    );
  }).pipe(Effect.catch(failed));

/**
 * The two ways a hold ends — verbs, not a save, each on its own crossing
 * permission. Both answer **`200` when the hold was already gone**: they are
 * compensations a saga dispatches at least once, and one that errored on its
 * second delivery would strand a flow that had in fact been fully reversed.
 * The body says which happened.
 */
const endHold = (to: 'released' | 'converted') => (organizationId: string) =>
  Effect.gen(function* () {
    // Always present: the path names it.
    const id = (yield* HttpRouter.params)['id'] as string;
    const ledger = yield* StockLedgerTag;
    const outcome = yield* ledger.end(organizationId, id, to);
    return yield* HttpServerResponse.json({ id, status: to, outcome });
  }).pipe(Effect.catch(failed));

/**
 * `POST /api/stock-restoration` — a cancelled order's goods going back, as a
 * new `cancellation` movement. Its own permission, `stock-movement:restore`,
 * so a crossing token writes this one correction and never a receipt or an
 * adjustment; idempotent on the command id because the cancellation saga
 * dispatches it after its pivot.
 */
const restore = (organizationId: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const movement = yield* readEntityEnvelope(
      StockMovement,
      yield* request.json,
    );
    const outcome = yield* restoreStock({
      organizationId,
      movement,
      commandId: commandIdOf(request),
    });
    const restored = outcome.movement;
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(StockMovement, restored, [
        {
          rel: 'self',
          href: `/api/stock-movement/${String(restored.id)}`,
          method: 'GET',
        },
        { rel: 'list', href: '/api/stock-movement', method: 'GET' },
        stockItemLink(restored.offeringId),
      ]),
      { status: outcome._tag === 'restored' ? 201 : 200 },
    );
  }).pipe(Effect.catch(failed));

/**
 * stock-service's surface. **Every read is a session bound to the caller's
 * organization** — a vendor's stock position is exactly what a competitor
 * would want, and what the storefront shows is a projection and a hint
 * (ADR 0010).
 *
 * ⚠️ The crossing routes take a token and **no** session, and the reads beside
 * them a session and no token. One route, one credential, each way: what
 * ADR 0023 forbids is one *route* accepting either, because then the weaker
 * credential is the security level.
 *
 * `StockItem` is read-only by design: `onHand` and `reserved` move by `$inc`
 * over the ledger and by the conditional hold, never by a save.
 */
export const stockRoutes = Layer.mergeAll(
  makeEntityRoutes(StockItem, {
    verbs: ['list', 'get'],
    guard: { kind: 'organization' },
  }),
  makeEntityRoutes<Reservation, OverrideServices>(Reservation, {
    verbs: ['list', 'get', 'create'],
    guard: {
      read: { kind: 'organization' },
      write: { kind: 'crossing', organization: true },
    },
    override: { create: take },
  }),
  makeEntityRoutes<StockMovement, OverrideServices>(StockMovement, {
    verbs: ['list', 'get', 'create'],
    guard: { kind: 'organization' },
    override: { create: record },
  }),
  HttpRouter.addAll([
    HttpRouter.route(
      'DELETE',
      '/api/reservation/:id',
      requireServiceCrossing('stock-management:reservation:release')(
        endHold('released'),
      ),
    ),
    HttpRouter.route(
      'POST',
      '/api/reservation/:id/conversion',
      requireServiceCrossing('stock-management:reservation:convert')(
        endHold('converted'),
      ),
    ),
    HttpRouter.route(
      'POST',
      '/api/stock-restoration',
      requireServiceCrossing('stock-management:stock-movement:restore')(
        restore,
      ),
    ),
  ]),
);
