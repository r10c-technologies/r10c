import { randomUUID } from 'node:crypto';

import {
  Agreement,
  CommissionEntry,
} from '@r10c/business-ts-settlement-management';
import type { InboxClaim } from '@r10c/entifix-transactions';
import {
  deserializeSingleEntity,
  EntifixConnError,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import {
  INBOX_COLLECTION,
  inboxDocument,
  isDuplicateKey,
} from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import {
  AGREEMENT_COLLECTION,
  COMMISSION_ENTRY_COLLECTION,
} from '../settlement-index';
import type { VendorCommission } from './commission';

/**
 * Where the two halves of a sale meet.
 *
 * ⚠️ **A non-entity record, deliberately.** It is a join in flight rather than
 * anything a person reads, the same kind of row the store register's "a store
 * with no hosts" note describes — sessions, locks, sequences. Giving it an
 * `@entity()` would put a permission namespace, a label catalog and a CRUD
 * surface around a piece of bookkeeping.
 *
 * ⚠️ **Neither half is assumed to arrive first.** `order.placed` comes off
 * order-service's outbox and `payment.captured` off payment-service's, through
 * different queues, with independent relays and independent retries. Any
 * ordering rule between them would be a guess, so the record is written by both
 * and the fold is performed by whichever completes the pair.
 */
export const PENDING_SALE_COLLECTION = 'settlement_pending_sale';

export interface PendingSale {
  readonly orderId: string;
  /**
   * The order's half: its lines, already priced.
   *
   * ⚠️ **Priced on arrival rather than at fold time**, because only this half
   * carries the lines and the channel. Doing it here means the capture handler
   * needs no agreement read and no arithmetic at all — it contributes a
   * timestamp and, if it is the second to arrive, writes what is already
   * computed.
   *
   * It also fixes *when* the rate is read: the agreement in force when the sale
   * was placed. ADR 0022 §8 captures commission per sale precisely so a later
   * rate change cannot rewrite history, and pricing at fold time would reopen
   * exactly that window.
   */
  readonly commissions?: readonly VendorCommission[];
  /** Vendors on the order that no agreement covers. Recorded, never guessed. */
  readonly unpriced?: readonly string[];
  /** The payment's half. ISO-8601, and the entries' `occurredAt`. */
  readonly decidedAt?: string;
  /** Whether the commission entries have been written. */
  readonly folded: boolean;
}

/** The pair is complete when both halves have landed. */
const isComplete = (
  sale: PendingSale,
): sale is PendingSale & {
  commissions: readonly VendorCommission[];
  decidedAt: string;
} => sale.commissions !== undefined && sale.decidedAt !== undefined;

/**
 * The index the join rides: one document per order.
 *
 * Unique, because two upserts for one order racing each other would otherwise
 * each insert their own document and each hold one half forever — the fold would
 * never fire and nothing would say so.
 */
export const ensurePendingSaleIndexes = (db: Db) =>
  Effect.promise(() =>
    db
      .collection(PENDING_SALE_COLLECTION)
      .createIndex({ orderId: 1 }, { unique: true, name: 'orderId_1' }),
  );

/**
 * Read the agreements in force for the vendors on an order.
 *
 * Sorted by `effectiveFrom` descending and taking the first per vendor: settling
 * means finding the agreement that applied, and a vendor may have several on
 * file as terms are re-negotiated.
 *
 * ⚠️ **A vendor with no agreement is simply absent from the map**, and the
 * caller names them rather than pricing them. See `commissionsForOrder`.
 */
export const agreementsFor = (db: Db, vendorIds: readonly string[]) =>
  Effect.gen(function* () {
    const documents = yield* Effect.promise(() =>
      db
        .collection(AGREEMENT_COLLECTION)
        .find({ vendorId: { $in: [...vendorIds] } })
        .sort({ effectiveFrom: -1 })
        .toArray(),
    );

    const agreements = new Map<string, Agreement>();
    for (const document of documents) {
      const agreement = yield* deserializeSingleEntity(Agreement, document);
      if (agreement !== undefined && !agreements.has(agreement.vendorId)) {
        agreements.set(agreement.vendorId, agreement);
      }
    }
    return agreements as ReadonlyMap<string, Agreement>;
  });

/** The commission entries a completed pair becomes, in the wire shape. */
const entryDocuments = (
  orderId: string,
  commissions: readonly VendorCommission[],
  decidedAt: string,
): Record<string, unknown>[] =>
  commissions.map(commission => {
    const entry = new CommissionEntry(
      orderId,
      commission.vendorId,
      commission.saleAmount,
      commission.commissionAmount,
      commission.currency,
      new Date(decidedAt),
    );
    entry.id = randomUUID();
    return { ...serializeEntity(CommissionEntry, entry), id: entry.id };
  });

/**
 * What one handler contributes to the join.
 *
 * `commissions` and `unpriced` travel together because they are one pricing
 * pass; `decidedAt` is the other half on its own.
 */
export type SaleHalf =
  | {
      readonly commissions: readonly VendorCommission[];
      readonly unpriced: readonly string[];
    }
  | { readonly decidedAt: string };

/** What the write did, so the caller can log it and the bus can ack. */
export type FoldOutcome =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'folded'; readonly entries: number }
  | { readonly kind: 'duplicate' };

/**
 * Claim the message, contribute a half, and fold if that completed the pair —
 * all in one Mongo transaction.
 *
 * ⚠️ **The claim and the effect commit together or not at all.** That is the
 * whole mechanism: a claim written separately from the write it guards leaves a
 * message marked handled that was not, or a write with nothing to stop the
 * redelivery repeating it.
 *
 * ⚠️ **`folded: false` is in the filter of the fold's own update, not just its
 * `$set`.** Two redeliveries arriving together would otherwise both read a
 * complete pair and both write entries; the conditional write means exactly one
 * of them matches, and the unique index on `(orderId, vendorId)` is the backstop
 * if even that is somehow raced.
 *
 * A duplicate key on the *claim* means this message was already handled, and the
 * correct answer is to ack it. Nacking would requeue it against
 * `x-delivery-limit` and eventually quarantine a message that was in fact
 * processed (ADR 0030).
 */
export const contributeToSale = (
  client: MongoClient,
  db: Db,
  consumer: string,
  eventId: string,
  orderId: string,
  half: SaleHalf,
) =>
  Effect.tryPromise({
    try: async (): Promise<FoldOutcome> => {
      const session = client.startSession();
      try {
        let outcome: FoldOutcome = { kind: 'waiting' };
        await session.withTransaction(async () => {
          await db
            .collection<InboxClaim>(INBOX_COLLECTION)
            .insertOne(inboxDocument(consumer, eventId), { session });

          const merged = await db
            .collection<PendingSale>(PENDING_SALE_COLLECTION)
            .findOneAndUpdate(
              { orderId },
              { $set: half, $setOnInsert: { orderId, folded: false } },
              { upsert: true, returnDocument: 'after', session },
            );

          if (merged === null || !isComplete(merged) || merged.folded) {
            outcome = { kind: 'waiting' };
            return;
          }

          const claimed = await db
            .collection<PendingSale>(PENDING_SALE_COLLECTION)
            .updateOne(
              { orderId, folded: false },
              { $set: { folded: true } },
              { session },
            );

          if (claimed.modifiedCount === 0) {
            outcome = { kind: 'waiting' };
            return;
          }

          const documents = entryDocuments(
            orderId,
            merged.commissions,
            merged.decidedAt,
          );
          if (documents.length > 0) {
            await db
              .collection(COMMISSION_ENTRY_COLLECTION)
              .insertMany(documents, { session });
          }
          outcome = { kind: 'folded', entries: documents.length };
        });
        return outcome;
      } finally {
        await session.endSession();
      }
    },
    catch: error => {
      // Not a failure: the unique index rejected a second claim for this
      // consumer and message, which is how a redelivery is identified. The
      // transaction aborted with it, so nothing was written twice either.
      if (isDuplicateKey(error)) {
        return { kind: 'duplicate' } as const;
      }
      return new EntifixConnError('Failed to fold the sale', error, {
        consumer,
        eventId,
        orderId,
      });
    },
  }).pipe(
    // The duplicate arm above leaves the "error" channel carrying an outcome,
    // so lift it back: a redelivery must ack, never nack.
    Effect.catchAll(error =>
      error instanceof EntifixConnError
        ? Effect.fail(error)
        : Effect.succeed(error),
    ),
  );
