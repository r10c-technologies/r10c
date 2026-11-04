import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  IdempotencyKeyTag,
  OrganizationIdTag,
} from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  type EntifixEnvelopeLink,
  entityKey,
  implement,
  Invalid,
  InvalidEnvelope,
  JsonBody,
  makeEntityEnvelope,
  readEntityEnvelope,
} from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  InconsistentMovement,
  InsufficientStock,
  recordMovement,
  Reservation,
  restoreStock,
  StockItem,
  StockLedgerTag,
  StockMovement,
  takeReservation,
} from '@r10c/business-ts-stock-management';
import { Effect, Option, Schema } from 'effect';

/** The per-organization store refuses a scope with none; the guards always name one. */
const organizationOf = (context: EntityApiContext) =>
  context.organizationId as string;

/** The `Idempotency-Key` a crossing write is claimed on, in its unit of work. */
const commandId = Effect.map(
  Effect.serviceOption(IdempotencyKeyTag),
  Option.getOrUndefined,
);

/** Back to the item a hold or a movement moved — the fold it explains. */
const stockItemLink = (offeringId: string): EntifixEnvelopeLink => ({
  rel: 'stock-item',
  href: `/api/stock-item?rsql=offeringId==${offeringId}`,
  method: 'GET',
});

const linksFor = (
  context: EntityApiContext,
  id: string,
  offeringId: string,
): EntifixEnvelopeLink[] => [
  ...context.links.record(id),
  ...context.links.collection(),
  stockItemLink(offeringId),
];

/**
 * `StockItem` is read-only by design: `onHand` and `reserved` move by `$inc`
 * over the ledger and by the conditional hold, never by a save. **Every read
 * is a session bound to the caller's organization** — a vendor's stock
 * position is exactly what a competitor would want (ADR 0010).
 */
export const stockItemApi = defineEntityApi(
  StockItem,
  entityKey(StockItem, 'stock-item'),
  { verbs: ['list', 'get'], guard: { kind: 'organization' } },
);

/**
 * A vendor's own ledger line, behind their session. Append-only: there is no
 * `PUT` and no `DELETE`, and a correction is a new movement with
 * `reason: 'adjustment'`.
 */
export const stockMovementApi = defineEntityApi(
  StockMovement,
  entityKey(StockMovement, 'stock-movement'),
  {
    verbs: ['list', 'get', 'create'],
    guard: { kind: 'organization' },
    override: {
      create: {
        errors: [InvalidBody, InconsistentMovement, Invalid],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const movement = yield* readEntityEnvelope(
              StockMovement,
              request.payload,
            );
            const recorded = yield* recordMovement({
              organizationId: organizationOf(context),
              movement,
            });
            return makeEntityEnvelope(
              StockMovement,
              recorded,
              linksFor(context, String(recorded.id), recorded.offeringId),
            );
          }),
      },
    },
  },
);

/**
 * `POST /api/reservation` — the platform → tenant crossing (ADR 0023): a
 * service token plus `reservation:write`, the organization named in a header,
 * and **no session**. A redelivered command answers the hold it already took,
 * claimed in the same unit of work as the take: refusing it would read as
 * "out of stock" to a coordinator that cannot tell the two apart, and a
 * compensation would then release a hold it believes was never taken. Less
 * free than asked is `insufficientStock`, a conflict carrying what is free.
 */
export const reservationApi = defineEntityApi(
  Reservation,
  entityKey(Reservation, 'reservation'),
  {
    verbs: ['list', 'get', 'create'],
    guard: {
      read: { kind: 'organization' },
      write: { kind: 'crossing', organization: true },
    },
    override: {
      create: {
        idempotent: 'unit',
        errors: [InvalidBody, InsufficientStock, Invalid],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const reservation = yield* readEntityEnvelope(
              Reservation,
              request.payload,
            );
            const { reservation: held } = yield* takeReservation({
              organizationId: organizationOf(context),
              reservation,
              commandId: yield* commandId,
            });
            return makeEntityEnvelope(
              Reservation,
              held,
              linksFor(context, String(held.id), held.offeringId),
            );
          }),
      },
    },
  },
);

const HoldEnded = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(['released', 'converted']),
  outcome: Schema.Literals(['transitioned', 'not-held']),
});

const release = defineEndpoint({
  name: 'release',
  method: 'DELETE',
  path: '/api/reservation/:id',
  params: { id: Schema.String },
  success: HoldEnded,
  errors: [Invalid, DuplicateKey],
  guard: {
    kind: 'crossing',
    permission: 'stock-management:reservation:release',
    organization: true,
  },
  idempotent: 'edge',
});

const conversion = defineEndpoint({
  name: 'conversion',
  method: 'POST',
  path: '/api/reservation/:id/conversion',
  params: { id: Schema.String },
  success: HoldEnded,
  errors: [Invalid, DuplicateKey],
  guard: {
    kind: 'crossing',
    permission: 'stock-management:reservation:convert',
    organization: true,
  },
  idempotent: 'edge',
});

const restoration = defineEndpoint({
  name: 'restoration',
  method: 'POST',
  path: '/api/stock-restoration',
  payload: JsonBody,
  success: JsonBody,
  errors: [
    InconsistentMovement,
    InvalidBody,
    InvalidEnvelope,
    Invalid,
    DuplicateKey,
  ],
  guard: {
    kind: 'crossing',
    permission: 'stock-management:stock-movement:restore',
    organization: true,
  },
  idempotent: 'unit',
});

/**
 * Both ways a hold ends answer **`200` when it was already gone**: they are
 * compensations a saga dispatches at least once, and one that errored on its
 * second delivery would strand a flow that had in fact been reversed. The
 * body says which happened. Remembered at the edge, since ending a hold
 * claims nothing in its own write.
 */
const endHold =
  (to: 'released' | 'converted') =>
  ({ params }: { readonly params: { readonly id: string } }) =>
    Effect.gen(function* () {
      const organizationId = yield* OrganizationIdTag;
      const ledger = yield* StockLedgerTag;
      const outcome = yield* ledger.end(organizationId, params.id, to);
      return { id: params.id, status: to, outcome };
    });

/**
 * The hold's two endings and a cancelled order's restoration — each on its
 * own crossing permission, so a token can make exactly the correction a flow
 * needs. A restoration is a new `cancellation` or `return` movement, by the
 * closed cause it names, never an un-conversion: the hold is spent by then and
 * the ledger is append-only.
 */
export const stockCrossingEndpoints = [
  implement(release, endHold('released')),
  implement(conversion, endHold('converted')),
  implement(restoration, ({ payload }) =>
    Effect.gen(function* () {
      const movement = yield* readEntityEnvelope(StockMovement, payload);
      const cause = (payload as { data?: { cause?: unknown } } | undefined)
        ?.data?.cause;
      if (cause !== 'cancellation' && cause !== 'return') {
        return yield* new InvalidBody({
          reason: "a restoration names its cause: 'cancellation' or 'return'",
        });
      }
      const { movement: restored } = yield* restoreStock({
        organizationId: yield* OrganizationIdTag,
        movement,
        cause,
        commandId: yield* commandId,
      });
      return makeEntityEnvelope(StockMovement, restored, [
        {
          rel: 'self',
          href: `/api/stock-movement/${String(restored.id)}`,
          method: 'GET',
        },
        { rel: 'list', href: '/api/stock-movement', method: 'GET' },
        stockItemLink(restored.offeringId),
      ]);
    }),
  ),
] as const;
