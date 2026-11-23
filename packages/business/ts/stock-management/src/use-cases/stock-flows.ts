import { Failure } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import { isSaleUnit, type SaleUnit } from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import type { Reservation } from '../entities/reservation';
import type { StockMovement } from '../entities/stock-movement';
import {
  type InUnit,
  ReservationMaxHoldSecondsTag,
  ReservationTtlSecondsTag,
  StockLedgerTag,
} from '../ports/stock-ledger';
import { isConsistentMovement } from '../values/movement-direction';
import { isMovementReason } from '../values/movement-reason';
import { isReservableQuantity } from '../values/reservable-quantity';

const MILLISECONDS = 1_000;

/** A movement whose sign contradicts its reason — a receipt that takes away. */
export class InconsistentMovement extends Failure.invalid<InconsistentMovement>()(
  'InconsistentMovement',
  'inconsistentMovement',
  { reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/**
 * How long a hold lives: the default, or what the coordinator stated — a whole
 * number of seconds no longer than `maxHoldSeconds` (ADR 0081 §3). Anything
 * else is the step's body to refuse, never a hold quietly shortened.
 */
/**
 * The record as the ledger takes it, its unit stated and one r10c sells in
 * (ADR 0082 §1, §4); refused otherwise, absent included.
 */
const inUnit = <T extends { readonly unit?: SaleUnit | undefined }>(
  record: T,
): Effect.Effect<InUnit<T>, InvalidBody> =>
  isSaleUnit(record.unit)
    ? Effect.succeed(record as InUnit<T>)
    : Effect.fail(
        new InvalidBody({
          reason: `"${String(record.unit)}" is not a sale unit`,
        }),
      );

const holdSecondsOf = (stated: unknown) =>
  Effect.gen(function* () {
    if (stated === undefined) return yield* ReservationTtlSecondsTag;
    const max = yield* ReservationMaxHoldSecondsTag;
    if (
      typeof stated !== 'number' ||
      !Number.isInteger(stated) ||
      stated <= 0 ||
      stated > max
    ) {
      return yield* Effect.fail(
        new InvalidBody({
          reason: `a hold lives between 1 and ${String(max)} seconds`,
        }),
      );
    }
    return stated;
  });

/**
 * Take a hold — the checkout flow's `reserve` step, for the organization the
 * crossing named. The id, the status and the expiry are this domain's; how
 * long it lives may be stated, within this domain's bound.
 */
export const takeReservation = (input: {
  readonly organizationId: string;
  readonly reservation: Reservation;
  readonly commandId: string | undefined;
  /** Seconds the hold lives, as the step stated it, or `undefined`. */
  readonly holdSeconds?: unknown;
}) =>
  Effect.gen(function* () {
    const { reservation } = input;
    if (!isReservableQuantity(reservation.quantity)) {
      return yield* Effect.fail(
        new InvalidBody({
          reason: `${String(reservation.quantity)} is not a reservable quantity`,
        }),
      );
    }
    const stated = yield* inUnit(reservation);
    const ttlSeconds = yield* holdSecondsOf(input.holdSeconds);
    stated.id = globalThis.crypto.randomUUID();
    stated.status = 'held';
    stated.expiresAt = new Date(Date.now() + ttlSeconds * MILLISECONDS);

    const ledger = yield* StockLedgerTag;
    return yield* ledger.take(input.organizationId, stated, input.commandId);
  });

/** A vendor's own movement: a delivery, a count, a write-off. */
export const recordMovement = (input: {
  readonly organizationId: string;
  readonly movement: StockMovement;
}) =>
  Effect.gen(function* () {
    const { movement } = input;
    if (!isMovementReason(movement.reason)) {
      return yield* Effect.fail(
        new InvalidBody({
          reason: `"${String(movement.reason)}" is not a movement reason`,
        }),
      );
    }
    if (!isConsistentMovement(movement.reason, movement.quantity)) {
      return yield* Effect.fail(
        new InconsistentMovement({
          reason: `a movement of ${String(movement.quantity)} cannot be a ${movement.reason}`,
        }),
      );
    }
    const stated = yield* inUnit(movement);
    stated.id = globalThis.crypto.randomUUID();
    stated.occurredAt = new Date();
    stated.causeType = 'manual';
    stated.causeId = stated.id;
    const ledger = yield* StockLedgerTag;
    return yield* ledger.record(input.organizationId, stated);
  });

/** Why goods are put back: an order cancelled, or a parcel returned. */
export const RestorationCauses = ['cancellation', 'return'] as const;
export type RestorationCause = (typeof RestorationCauses)[number];

/**
 * An order's goods going back — a cancellation's or a return's `restore`
 * step. A new `+quantity` movement, never an un-conversion: the hold is spent
 * by then and the ledger is append-only. The reason is this domain's to write
 * from a closed cause, so the crossing can make these two corrections and not
 * any other.
 */
export const restoreStock = (input: {
  readonly organizationId: string;
  readonly movement: StockMovement;
  readonly cause: RestorationCause;
  /** The order whose goods go back: the movement's cause. */
  readonly orderId: string;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { movement } = input;
    movement.reason = input.cause;
    if (!isConsistentMovement(movement.reason, movement.quantity)) {
      return yield* Effect.fail(
        new InconsistentMovement({
          reason: `a restoration of ${String(movement.quantity)} is not a quantity going back`,
        }),
      );
    }
    const stated = yield* inUnit(movement);
    stated.id = globalThis.crypto.randomUUID();
    stated.occurredAt = new Date();
    stated.causeType = 'product-order';
    stated.causeId = input.orderId;
    const ledger = yield* StockLedgerTag;
    return yield* ledger.restore(input.organizationId, stated, input.commandId);
  });
