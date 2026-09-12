import { randomUUID } from 'node:crypto';

import type { CommissionEntryKind } from '@r10c/business-ts-settlement-management';
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
import { reversalOf, type VendorCommission } from './commission';

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
 *
 * ⚠️ **One document per order carries *four* halves, not two.** The reversal's
 * pair — `order.cancelled` and `payment.refunded` — lands here beside the sale's
 * rather than in a collection of its own, and the reason is the sentence above
 * applied across both folds instead of only within one. A separate reversal
 * record has no way to see whether the sale was ever folded: if `order.placed`
 * is quarantined or its relay is stuck when the cancellation pair completes, the
 * reversal finds no ledger rows, writes nothing, marks itself done — and the
 * replay of the placement then writes a commission that nothing will ever
 * reverse. Sharing the document lets the reversal require {@link
 * PendingSale.folded}, and lets a late placement write the sale *and* its
 * reversal in one transaction.
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
  /**
   * The cancellation's half: that the order was cancelled at all.
   *
   * It contributes no amounts. A reversal mirrors the rows already in the
   * ledger, so what this half adds is the *fact* — money going back is not on
   * its own a cancellation, and an order cancelled before it was ever paid has
   * nothing to reverse. Both must be true.
   */
  readonly cancelledAt?: string;
  /** The refund's half. ISO-8601, and the reversing rows' `occurredAt`. */
  readonly refundedAt?: string;
  /** Whether the reversing entries have been written. */
  readonly reversed?: boolean;
}

/** The sale's pair is complete when both of its halves have landed. */
const isComplete = (
  sale: PendingSale,
): sale is PendingSale & {
  commissions: readonly VendorCommission[];
  decidedAt: string;
} => sale.commissions !== undefined && sale.decidedAt !== undefined;

/** The reversal's pair is complete when both of *its* halves have landed. */
const isReversible = (
  sale: PendingSale,
): sale is PendingSale & { cancelledAt: string; refundedAt: string } =>
  sale.cancelledAt !== undefined && sale.refundedAt !== undefined;

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
  occurredAt: string,
  kind: CommissionEntryKind,
): Record<string, unknown>[] =>
  commissions.map(commission => {
    const entry = new CommissionEntry(
      orderId,
      commission.vendorId,
      commission.saleAmount,
      commission.commissionAmount,
      commission.currency,
      new Date(occurredAt),
      kind,
    );
    entry.id = randomUUID();
    return { ...serializeEntity(CommissionEntry, entry), id: entry.id };
  });

/**
 * A stored ledger line, as the reversal reads it back.
 *
 * The four members a mirror needs and nothing else — `id`, `occurredAt` and
 * `runId` all belong to the row being reversed and none of them is carried
 * across. In particular the mirror carries **no `runId`**, so the next sweep
 * picks it up as any other unsettled line.
 */
interface LedgerLine {
  readonly vendorId: string;
  readonly saleAmount: number;
  readonly commissionAmount: number;
  readonly currency: string;
}

/**
 * The mirrors of an order's recorded sale lines.
 *
 * ⚠️ **`occurredAt` is the refund's own decision time, never the sale's and
 * never `now`.** It is what a settlement run compares against its period, so
 * copying the sale's timestamp would file the claw-back in a period that may
 * already be settled, and stamping the handling time would file it differently
 * on every redelivery or replay.
 */
const reversalDocuments = (
  orderId: string,
  lines: readonly LedgerLine[],
  refundedAt: string,
): Record<string, unknown>[] =>
  entryDocuments(orderId, lines.map(reversalOf), refundedAt, 'reversal');

/**
 * What one handler contributes to the join. One arm per subscribed message.
 *
 * `commissions` and `unpriced` travel together because they are one pricing
 * pass; the other three are each a timestamp on its own. Only `decidedAt` and
 * `refundedAt` are ever read as values — `cancelledAt` exists to be *present*,
 * because a refund alone does not say the order was cancelled and a cancellation
 * alone does not say the money went back.
 */
export type SaleHalf =
  | {
      readonly commissions: readonly VendorCommission[];
      readonly unpriced: readonly string[];
    }
  | { readonly decidedAt: string }
  | { readonly cancelledAt: string }
  | { readonly refundedAt: string };

/**
 * What the write did, so the caller can log it and the bus can ack.
 *
 * `written` counts both directions because one pass can now do both: a placement
 * arriving after its order was already cancelled and refunded completes the sale
 * and its reversal in the same transaction.
 */
export type FoldOutcome =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'duplicate' }
  | {
      readonly kind: 'written';
      readonly folded: number;
      readonly reversed: number;
    };

/**
 * Claim the message, contribute a half, and write whichever of the two folds
 * that completed — all in one Mongo transaction.
 *
 * ⚠️ **The claim and the effect commit together or not at all.** That is the
 * whole mechanism: a claim written separately from the write it guards leaves a
 * message marked handled that was not, or a write with nothing to stop the
 * redelivery repeating it.
 *
 * ⚠️ **`folded: false` is in the filter of the fold's own update, not just its
 * `$set`**, and `reversed` is claimed the same conditional way. Two redeliveries
 * arriving together would otherwise both read a complete pair and both write
 * entries; the conditional write means exactly one of them matches, and the
 * unique index on `(orderId, vendorId, kind)` is the backstop if even that is
 * somehow raced.
 *
 * ⚠️ **Both folds are attempted, in that order, on every pass.** They are not
 * alternatives. An `order.placed` that arrives after its order has already been
 * cancelled and refunded completes the sale *and* its reversal here, in one
 * transaction — which is the case a separate reversal record could not express
 * and would silently drop.
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
          // Re-entered verbatim when the driver retries a write conflict, so
          // every counter is reset rather than accumulated across attempts.
          let folded = 0;
          let reversed = 0;
          outcome = { kind: 'waiting' };

          await db
            .collection<InboxClaim>(INBOX_COLLECTION)
            .insertOne(inboxDocument(consumer, eventId), { session });

          const merged = await db
            .collection<PendingSale>(PENDING_SALE_COLLECTION)
            .findOneAndUpdate(
              { orderId },
              {
                $set: half,
                $setOnInsert: { orderId, folded: false, reversed: false },
              },
              { upsert: true, returnDocument: 'after', session },
            );

          if (merged === null) return;

          const sales = db.collection<PendingSale>(PENDING_SALE_COLLECTION);
          const ledger = db.collection(COMMISSION_ENTRY_COLLECTION);

          // The sale. `saleFolded` tracks whether this order's ledger rows exist
          // at all, which is what the reversal below needs to know — and a lost
          // claim answers that question just as well as a won one.
          let saleFolded = merged.folded;
          if (!saleFolded && isComplete(merged)) {
            const claimed = await sales.updateOne(
              { orderId, folded: false },
              { $set: { folded: true } },
              { session },
            );
            saleFolded = true;
            if (claimed.modifiedCount > 0) {
              const documents = entryDocuments(
                orderId,
                merged.commissions,
                merged.decidedAt,
                'sale',
              );
              if (documents.length > 0) {
                await ledger.insertMany(documents, { session });
              }
              folded = documents.length;
            }
          }

          // The reversal, over the rows the sale wrote — including the ones
          // written a few lines above, which this transaction can read back.
          //
          // ⚠️ `saleFolded` in the condition is the ordering rule: a reversal
          // can never precede the sale it mirrors, and a cancellation whose
          // placement has not arrived stays pending until it does.
          //
          // ⚠️ `reversed: { $ne: true }` rather than `reversed: false`. A
          // document written before this member existed carries none at all, and
          // an equality filter would never match it — a record stuck forever in
          // a state nothing reports.
          if (saleFolded && merged.reversed !== true && isReversible(merged)) {
            const claimed = await sales.updateOne(
              { orderId, reversed: { $ne: true } },
              { $set: { reversed: true } },
              { session },
            );
            if (claimed.modifiedCount > 0) {
              const lines = (await ledger
                .find({ orderId, kind: 'sale' }, { session })
                .toArray()) as unknown as LedgerLine[];
              const documents = reversalDocuments(
                orderId,
                lines,
                merged.refundedAt,
              );
              if (documents.length > 0) {
                await ledger.insertMany(documents, { session });
              }
              reversed = documents.length;
            }
          }

          if (folded > 0 || reversed > 0) {
            outcome = { kind: 'written', folded, reversed };
          }
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
