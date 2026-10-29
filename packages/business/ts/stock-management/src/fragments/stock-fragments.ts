import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-saga-contracts';
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
 */
export const stockReserve = defineFragment({
  id: 'stock.reserve',
  version: 1,
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
      quantity: Schema.Number,
    }),
    output: openStruct({ id: ReservationId }),
    failure: participantRefusal(['invalidBody', 'insufficientStock']),
  },
});

/**
 * Turn a hold into a sale. After the commit point, so retried rather than
 * compensated; answers `200` when the hold was already converted.
 */
export const stockConvert = defineFragment({
  id: 'stock.convert',
  version: 1,
  module: 'stock-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/reservation/:id/conversion' },
  cardinality: 'perLine',
  isolation: 'commutative',
  requires: REQUIRES,
  consumes: { reservationId: ReservationId },
  contract: {
    input: Schema.Struct({}),
    output: openStruct({ id: ReservationId, status: Schema.String }),
    failure: participantRefusal([]),
  },
});

/**
 * Put a cancelled order's goods back, as a new `+quantity` movement — never an
 * un-conversion, since the ledger is append-only (ADR 0058).
 */
export const stockRestore = defineFragment({
  id: 'stock.restore',
  version: 1,
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
      quantity: Schema.Number,
    }),
    output: openStruct({ id: Schema.String }),
    failure: participantRefusal(['invalidBody', 'inconsistentMovement']),
  },
});

/** Every fragment stock-management contributes. */
export const STOCK_FRAGMENTS = [
  stockReserve,
  stockConvert,
  stockRestore,
] as const;
