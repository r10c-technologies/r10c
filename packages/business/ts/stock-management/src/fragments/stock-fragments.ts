import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-flow-contracts';
import { SaleUnits } from '@r10c/business-ts-sales-vocabulary';
import { Schema } from 'effect';

/** The participant every stock fragment calls. */
const PARTICIPANT = 'stock-service';

/** A hold's id, provided by a reservation and consumed by its conversion. */
const ReservationId = Schema.String;

const REQUIRES = { entitlements: ['stock-management'] } as const;

/**
 * Take a hold on one line's stock. Compensated by releasing it, and
 * commutative: two holds on one item commute, because a hold is a conditional
 * `$inc` rather than a read-modify-write (ADR 0010).
 *
 * `holdSeconds`, when the coordinator states it, is how long this hold lives —
 * a payment-link order's must outlive the seller's decision (ADR 0081 §3) —
 * bounded by stock-service's own `reservation.maxHoldSeconds`. Without it the
 * hold keeps the default.
 */
export const stockReserve = defineFragment({
  id: 'stock.reserve',
  version: 4,
  module: 'stock-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/reservation' },
  compensation: { method: 'DELETE', path: '/api/reservation/:id' },
  cardinality: 'perLine',
  isolation: 'commutative',
  requires: REQUIRES,
  provides: { reservationId: ReservationId },
  contract: {
    input: openStruct({
      offeringId: Schema.NonEmptyString,
      // The line's unit and a quantity in its scale (ADR 0082 §4): a hold in
      // another unit than the item's is refused, never added.
      unit: Schema.Literals(SaleUnits),
      quantity: Schema.Int,
      holdSeconds: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    }),
    output: openStruct({ id: ReservationId }),
    failure: participantRefusal([
      'invalidBody',
      'insufficientStock',
      'unitMismatch',
    ]),
  },
});

/**
 * Turn a hold into a sale. After the commit point — the capture for a card
 * checkout, `flow.commit` for cash on delivery — so retried rather than
 * compensated; answers `200` when the hold was already converted or had
 * already expired, without writing a movement (ADR 0070).
 */
export const stockConvert = defineFragment({
  id: 'stock.convert',
  version: 3,
  module: 'stock-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/reservation/:reservationId/conversion' },
  cardinality: 'perLine',
  isolation: 'commutative',
  requires: REQUIRES,
  consumes: { reservationId: ReservationId },
  contract: {
    input: openStruct({ reservationId: ReservationId }),
    output: openStruct({ id: ReservationId, status: Schema.String }),
    failure: participantRefusal([]),
  },
});

/**
 * Release a hold after the commit point — a payment-link order the buyer never
 * paid (ADR 0081 §2). The same route a reservation's compensation calls, which
 * is already total: it answers `200` whether the hold was released, swept or
 * never there, so retrying it is safe.
 */
export const stockRelease = defineFragment({
  id: 'stock.release',
  version: 1,
  module: 'stock-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'DELETE', path: '/api/reservation/:reservationId' },
  cardinality: 'perLine',
  isolation: 'commutative',
  requires: REQUIRES,
  consumes: { reservationId: ReservationId },
  contract: {
    input: openStruct({ reservationId: ReservationId }),
    output: openStruct({ id: ReservationId, status: Schema.String }),
    failure: participantRefusal([]),
  },
});

/**
 * Put an order's goods back, as a new `+quantity` movement — never an
 * un-conversion, since the ledger is append-only (ADR 0058). `cause` says why:
 * a cancellation, or a parcel returned (ADR 0070). `orderId` names the order
 * the goods go back for, which the movement records as its cause (ADR 0078 §6).
 */
export const stockRestore = defineFragment({
  id: 'stock.restore',
  version: 5,
  module: 'stock-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/stock-restoration' },
  cardinality: 'perLine',
  isolation: 'commutative',
  requires: REQUIRES,
  contract: {
    input: openStruct({
      offeringId: Schema.NonEmptyString,
      unit: Schema.Literals(SaleUnits),
      quantity: Schema.Int,
      cause: Schema.Literals(['cancellation', 'return']),
      orderId: Schema.NonEmptyString,
    }),
    output: openStruct({ id: Schema.String }),
    failure: participantRefusal([
      'invalidBody',
      'inconsistentMovement',
      'unitMismatch',
    ]),
  },
});

/** Every fragment stock-management contributes. */
export const STOCK_FRAGMENTS = [
  stockReserve,
  stockConvert,
  stockRelease,
  stockRestore,
] as const;
