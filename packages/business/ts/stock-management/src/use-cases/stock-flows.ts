import { Effect } from 'effect';

import type { Reservation } from '../entities/reservation';
import type { StockMovement } from '../entities/stock-movement';
import {
  ReservationTtlSecondsTag,
  StockLedgerTag,
} from '../ports/stock-ledger';
import { isConsistentMovement } from '../values/movement-direction';
import { isMovementReason } from '../values/movement-reason';
import { isReservableQuantity } from '../values/reservable-quantity';

const MILLISECONDS = 1_000;

/** A request the domain refuses as it stands. */
export class StockRefused {
  readonly _tag = 'StockRefused';
  constructor(
    readonly code: 'invalidBody' | 'inconsistentMovement',
    readonly detail: string,
  ) {}
}

/**
 * Take a hold — the checkout saga's `reserve` step, for the organization the
 * crossing named. The id, the status and the expiry are this domain's.
 */
export const takeReservation = (input: {
  readonly organizationId: string;
  readonly reservation: Reservation;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { reservation } = input;
    if (!isReservableQuantity(reservation.quantity)) {
      return yield* Effect.fail(
        new StockRefused(
          'invalidBody',
          `${String(reservation.quantity)} is not a reservable quantity`,
        ),
      );
    }
    const ttlSeconds = yield* ReservationTtlSecondsTag;
    reservation.id = globalThis.crypto.randomUUID();
    reservation.status = 'held';
    reservation.expiresAt = new Date(Date.now() + ttlSeconds * MILLISECONDS);

    const ledger = yield* StockLedgerTag;
    return yield* ledger.take(
      input.organizationId,
      reservation,
      input.commandId,
    );
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
        new StockRefused(
          'invalidBody',
          `"${String(movement.reason)}" is not a movement reason`,
        ),
      );
    }
    if (!isConsistentMovement(movement.reason, movement.quantity)) {
      return yield* Effect.fail(
        new StockRefused(
          'inconsistentMovement',
          `a movement of ${String(movement.quantity)} cannot be a ${movement.reason}`,
        ),
      );
    }
    movement.id = globalThis.crypto.randomUUID();
    const ledger = yield* StockLedgerTag;
    return yield* ledger.record(input.organizationId, movement);
  });

/**
 * A cancelled order's goods going back — the cancellation saga's
 * `restore-stock` step. A new `+quantity` movement, never an un-conversion:
 * the hold is spent by then and the ledger is append-only. The reason is this
 * domain's to write, so the crossing can make this one correction and not
 * any other.
 */
export const restoreStock = (input: {
  readonly organizationId: string;
  readonly movement: StockMovement;
  readonly commandId: string | undefined;
}) =>
  Effect.gen(function* () {
    const { movement } = input;
    movement.reason = 'cancellation';
    if (!isConsistentMovement(movement.reason, movement.quantity)) {
      return yield* Effect.fail(
        new StockRefused(
          'inconsistentMovement',
          `a restoration of ${String(movement.quantity)} is not a quantity going back`,
        ),
      );
    }
    movement.id = globalThis.crypto.randomUUID();
    const ledger = yield* StockLedgerTag;
    return yield* ledger.restore(
      input.organizationId,
      movement,
      input.commandId,
    );
  });
