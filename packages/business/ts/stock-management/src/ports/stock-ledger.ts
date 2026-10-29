import { Failure, type Invalid, type StoreFailure } from '@entifix/core';
import { Context, type Effect, Schema } from 'effect';

import type { Reservation } from '../entities/reservation';
import type { StockMovement } from '../entities/stock-movement';

/** How taking a hold went: a new hold, or the one a repeated command took. */
export type HoldOutcome =
  | { readonly _tag: 'held'; readonly reservation: Reservation }
  | { readonly _tag: 'replayed'; readonly reservation: Reservation };

/**
 * Less is free than a hold asked for. A conflict with the stock as it stands,
 * not a malformed request: the same hold succeeds once a delivery lands.
 * `available` is what was free when the hold was refused — a hint, since the
 * next hold may already have moved it.
 */
export class InsufficientStock extends Failure.conflict<InsufficientStock>()(
  'InsufficientStock',
  'insufficientStock',
  {
    offeringId: Schema.String,
    requested: Schema.Number,
    available: Schema.Number,
  },
  {
    message: ({ offeringId, requested, available }) =>
      `${String(requested)} of ${offeringId} asked for, ${String(available)} free`,
  },
) {}

/** How a restoration went. */
export type RestoreOutcome =
  | { readonly _tag: 'restored'; readonly movement: StockMovement }
  | { readonly _tag: 'replayed'; readonly movement: StockMovement };

/**
 * What reaching an organization's store can fail with: the store, or an
 * organization id the tenant resolver refuses.
 */
export type StockStoreFailure = StoreFailure | Invalid;

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
  ) => Effect.Effect<HoldOutcome, InsufficientStock | StockStoreFailure>;
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
  ) => Effect.Effect<'transitioned' | 'not-held', StockStoreFailure>;
  /** Append a vendor's own movement and move the counter with it. */
  readonly record: (
    organizationId: string,
    movement: StockMovement,
  ) => Effect.Effect<StockMovement, StockStoreFailure>;
  /** Put a cancelled order's goods back, claimed on the command. */
  readonly restore: (
    organizationId: string,
    movement: StockMovement,
    commandId: string | undefined,
  ) => Effect.Effect<RestoreOutcome, StockStoreFailure>;
  /**
   * Release every expired hold in every organization's store. Without it
   * `expiresAt` is a timestamp nothing reads, and an abandoned basket promises
   * a vendor's stock forever.
   *
   * Each hold is released on its own, so one that fails is **reported** and the
   * walk goes on; the slice shell logs what was reported (ADR 0064).
   */
  readonly releaseExpired: () => Effect.Effect<ExpirySweep, StockStoreFailure>;
}

/** What one pass over the expired holds did. */
export interface ExpirySweep {
  readonly released: number;
  /** The holds a release failed for, each with the failure it failed with. */
  readonly failed: ReadonlyArray<{
    readonly database: string;
    readonly reservationId: string;
    readonly failure: unknown;
  }>;
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
