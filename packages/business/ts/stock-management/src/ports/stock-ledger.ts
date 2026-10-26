import type { EntifixConnError } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { Reservation } from '../entities/reservation';
import type { StockMovement } from '../entities/stock-movement';

/** How taking a hold went. */
export type HoldOutcome =
  | { readonly _tag: 'held'; readonly reservation: Reservation }
  | { readonly _tag: 'replayed'; readonly reservation: Reservation }
  | { readonly _tag: 'insufficient' };

/** How a restoration went. */
export type RestoreOutcome =
  | { readonly _tag: 'restored'; readonly movement: StockMovement }
  | { readonly _tag: 'replayed'; readonly movement: StockMovement };

/**
 * The `stock` store, one organization's database at a time.
 *
 * ⚠️ **A quantity is never read-modify-written** (ADR 0010): every counter
 * moves by `$inc`, a hold is a *conditional* atomic take on what is free, and
 * every movement is appended to the ledger beside the counter it moved, in the
 * same unit.
 */
export interface StockLedger {
  /** Hold `quantity`, only if that much is free; claimed on the command. */
  readonly take: (
    organizationId: string,
    reservation: Reservation,
    commandId: string | undefined,
  ) => Effect.Effect<HoldOutcome, EntifixConnError>;
  /**
   * End a hold: `released` gives the quantity back; `converted` turns it into
   * a sale, which also leaves the shelf. `not-held` when it had already ended
   * — a compensation is delivered at least once, and erroring on the second
   * delivery would strand a flow that had in fact been reversed.
   */
  readonly end: (
    organizationId: string,
    reservationId: string,
    to: 'released' | 'converted',
  ) => Effect.Effect<'transitioned' | 'not-held', EntifixConnError>;
  /** Append a vendor's own movement and move the counter with it. */
  readonly record: (
    organizationId: string,
    movement: StockMovement,
  ) => Effect.Effect<StockMovement, EntifixConnError>;
  /** Put a cancelled order's goods back, claimed on the command. */
  readonly restore: (
    organizationId: string,
    movement: StockMovement,
    commandId: string | undefined,
  ) => Effect.Effect<RestoreOutcome, EntifixConnError>;
  /**
   * Release every expired hold in every organization's store. Without it
   * `expiresAt` is a timestamp nothing reads, and an abandoned basket promises
   * a vendor's stock forever.
   */
  readonly releaseExpired: () => Effect.Effect<number, EntifixConnError>;
}

export class StockLedgerTag extends Context.Service<
  StockLedgerTag,
  StockLedger
>()('StockLedgerTag') {}

/** How long a hold survives, from config-service. */
export class ReservationTtlSecondsTag extends Context.Service<
  ReservationTtlSecondsTag,
  number
>()('ReservationTtlSecondsTag') {}
