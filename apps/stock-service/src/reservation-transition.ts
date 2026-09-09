import { randomUUID } from 'node:crypto';

import {
  type MovementReason,
  Reservation,
  StockMovement,
} from '@r10c/business-ts-stock-management';
import {
  EntifixConnError,
  envelopeEntityName,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import { STOCK_ITEM_COLLECTION } from './stock-item-index';

export const RESERVATION_COLLECTION = envelopeEntityName(Reservation);
export const MOVEMENT_COLLECTION = envelopeEntityName(StockMovement);

/** What a transition attempt did. */
export type TransitionOutcome = 'transitioned' | 'not-held';

/** One hold, as the ledger needs to see it. */
interface HeldReservation {
  readonly id: string;
  readonly offeringId: string;
  readonly quantity: number;
}

/**
 * Move a hold out of `held`, and move `reserved` by the same amount.
 *
 * ⚠️ **One code path for release, conversion and the sweep**, and that is the
 * whole reason this function exists rather than three handlers. They differ only
 * in the state they write and whether a sale movement rides along; writing them
 * separately is how two of the three end up with subtly different conditions and
 * a hold that can be released twice.
 *
 * ⚠️ **The guard is the write, not a check before it.** The filter carries
 * `status: 'held'` and the update carries the transition, so the decision and
 * the mutation are one document operation no concurrent request can interleave
 * with. `matchedCount === 0` **is** the answer — already released, already
 * converted, or already swept — and it is deliberately *not* an error: a
 * compensating caller that retries must be idempotent by construction
 * ([ADR 0010](../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * Reading the hold before the transaction is safe for the same reason: the
 * quantity it yields is only ever *applied* inside the conditional write, so a
 * concurrent transition makes this one match nothing rather than double-count.
 */
export const transitionReservation = (
  client: MongoClient,
  db: Db,
  reservationId: string,
  to: 'released' | 'converted',
  /** A ledger movement to write in the same transaction, for a conversion. */
  movementReason?: MovementReason,
): Effect.Effect<TransitionOutcome, EntifixConnError> =>
  Effect.tryPromise({
    try: async () => {
      const held = (await db
        .collection(RESERVATION_COLLECTION)
        .findOne(
          { id: reservationId, status: 'held' },
          { projection: { _id: 0, id: 1, offeringId: 1, quantity: 1 } },
        )) as HeldReservation | null;

      if (!held) {
        return 'not-held' as const;
      }

      const session = client.startSession();
      try {
        let outcome: TransitionOutcome = 'not-held';
        // `withTransaction`, never a hand-rolled start/commit: an election
        // aborts an in-flight transaction with a `TransientTransactionError`
        // the application is expected to retry, and a retry here replays the
        // same conditional writes rather than moving `reserved` twice — the
        // filter no longer matches once the first attempt committed.
        await session.withTransaction(async () => {
          const moved = await db
            .collection(RESERVATION_COLLECTION)
            .updateOne(
              { id: reservationId, status: 'held' },
              { $set: { status: to } },
              { session },
            );

          if (moved.matchedCount === 0) {
            outcome = 'not-held';
            return;
          }

          // `$inc` by a negative, never an absolute write. The hold is giving
          // its claim back, and two holds released at once must both land.
          await db
            .collection(STOCK_ITEM_COLLECTION)
            .updateOne(
              { offeringId: held.offeringId },
              { $inc: { reserved: -held.quantity } },
              { session },
            );

          if (movementReason) {
            // ⚠️ A conversion is where stock actually leaves. `onHand` falls
            // here and nowhere else in this file — a release gives back a
            // claim, a conversion consumes goods — and the sign is the
            // ledger's own rule rather than a choice: `movementDirection('sale')`
            // is `'out'`, and `isConsistentMovement` refuses a positive one.
            const movement = new StockMovement(
              held.offeringId,
              -held.quantity,
              movementReason,
            );
            movement.id = randomUUID();
            await db
              .collection(MOVEMENT_COLLECTION)
              .insertOne(
                { ...serializeEntity(StockMovement, movement), id: movement.id },
                { session },
              );
            await db
              .collection(STOCK_ITEM_COLLECTION)
              .updateOne(
                { offeringId: held.offeringId },
                { $inc: { onHand: -held.quantity } },
                { session },
              );
          }

          outcome = 'transitioned';
        });
        return outcome;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      new EntifixConnError('Failed to transition the reservation', error, {
        reservationId,
        to,
      }),
  });
