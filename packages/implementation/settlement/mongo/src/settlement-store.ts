import {
  deserializeSingleEntity,
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  MongoUnitOfWorkTag,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import {
  Agreement,
  CommissionEntry,
  type CommissionEntryKind,
  type FoldOutcome,
  payoutFor,
  reversalOf,
  type RunOutcome,
  SaleJoinTag,
  SettlementRun,
  SettlementRunStoreTag,
  type VendorCommission,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { Effect, Layer } from 'effect';
import type { ClientSession, Db } from 'mongodb';

export const AGREEMENT_COLLECTION = envelopeEntityName(Agreement);
export const COMMISSION_ENTRY_COLLECTION = envelopeEntityName(CommissionEntry);
export const SETTLEMENT_RUN_COLLECTION = envelopeEntityName(SettlementRun);
export const VENDOR_PAYOUT_COLLECTION = envelopeEntityName(VendorPayout);
/** One join record per order: both halves of the sale and of its reversal. */
export const PENDING_SALE_COLLECTION = 'settlement_pending_sale';

interface PendingSale {
  readonly orderId: string;
  readonly commissions?: readonly VendorCommission[];
  readonly decidedAt?: string;
  readonly folded: boolean;
  readonly cancelledAt?: string;
  readonly refundedAt?: string;
  readonly reversed?: boolean;
}

interface LedgerLine {
  readonly vendorId: string;
  readonly saleAmount: number;
  readonly commissionAmount: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

/**
 * The indexes the ledger's invariants rest on. Three are load-bearing rather
 * than performance work: one sale entry per order and vendor and kind, one
 * payout per vendor per run, and one join record per order.
 */
export const ensureSettlementIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection(AGREEMENT_COLLECTION)
        .createIndex({ vendorId: 1, effectiveFrom: -1 }, { name: 'vendor_1' });
      await db
        .collection(COMMISSION_ENTRY_COLLECTION)
        .createIndex(
          { orderId: 1, vendorId: 1, kind: 1 },
          { unique: true, name: 'order_vendor_kind_1' },
        );
      await db
        .collection(COMMISSION_ENTRY_COLLECTION)
        .createIndex({ runId: 1, occurredAt: 1 }, { name: 'run_occurred_1' });
      await db
        .collection(COMMISSION_ENTRY_COLLECTION)
        .createIndex({ vendorId: 1, occurredAt: -1 }, { name: 'vendor_1' });
      await db
        .collection(VENDOR_PAYOUT_COLLECTION)
        .createIndex(
          { vendorId: 1, runId: 1 },
          { unique: true, name: 'vendor_run_1' },
        );
      await db
        .collection(SETTLEMENT_RUN_COLLECTION)
        .createIndex({ periodStart: 1, periodEnd: 1 }, { name: 'period_1' });
      await db
        .collection(PENDING_SALE_COLLECTION)
        .createIndex({ orderId: 1 }, { unique: true, name: 'orderId_1' });
    },
    catch: () => new Unavailable({ dependency: 'mongo' }),
  });

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

const entryDocuments = (
  orderId: string,
  commissions: readonly VendorCommission[],
  occurredAt: string,
  kind: CommissionEntryKind,
) =>
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
    entry.id = globalThis.crypto.randomUUID();
    return { ...serializeEntity(CommissionEntry, entry), id: entry.id };
  });

/**
 * The commission join and the settlement run over the `settlement` store.
 *
 * Each message's half lands on the order's join record in one unit with the
 * message's claim; whichever completes a pair writes its entries there too.
 * A run claims every unsettled line, writes the payouts and the run, and
 * announces `settlement.run.completed` in one unit, drained at commit.
 */
export const MongoSettlementStoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const units = yield* MongoUnitOfWorkTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const source = yield* EventSourceTag;

    yield* ensureSettlementIndexes(db);

    const afterCommit = drainOutboxNow(db).pipe(
      Effect.provideService(EventBusTag, bus),
      Effect.provideService(OutboxMaxAttempts, maxAttempts),
    );

    const promise = <A>(run: () => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: storeUnavailable });

    const agreementsFor = (vendorIds: readonly string[]) =>
      Effect.gen(function* () {
        const documents = yield* promise(() =>
          db
            .collection(AGREEMENT_COLLECTION)
            .find(
              { vendorId: { $in: [...vendorIds] } },
              { projection: { _id: 0 } },
            )
            .sort({ effectiveFrom: -1 })
            .toArray(),
        );
        // Newest first, so the first one seen per vendor is the one in force.
        const agreements = new Map<string, Agreement>();
        for (const document of documents) {
          // A stored document is never null, so it always reads back as one.
          const agreement = (yield* deserializeSingleEntity(
            Agreement,
            document,
          ).pipe(Effect.mapError(storeUnavailable))) as Agreement;
          if (!agreements.has(agreement.vendorId)) {
            agreements.set(agreement.vendorId, agreement);
          }
        }
        return agreements as ReadonlyMap<string, Agreement>;
      });

    /** The fold inside one unit: merge the half, then write whatever it completed. */
    const fold = (
      session: ClientSession,
      orderId: string,
      half: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const sales = db.collection<PendingSale>(PENDING_SALE_COLLECTION);
        const ledger = db.collection(COMMISSION_ENTRY_COLLECTION);

        const merged = (yield* promise(() =>
          sales.findOneAndUpdate(
            { orderId },
            {
              $set: half,
              $setOnInsert: { orderId, folded: false, reversed: false },
            },
            {
              upsert: true,
              returnDocument: 'after',
              projection: { _id: 0 },
              session,
            },
          ),
        )) as PendingSale;

        let folded = 0;
        let reversed = 0;
        let saleFolded = merged.folded;

        // The sale: its priced lines and the capture, both present.
        if (
          !saleFolded &&
          merged.commissions !== undefined &&
          merged.decidedAt !== undefined
        ) {
          yield* promise(() =>
            sales.updateOne(
              { orderId },
              { $set: { folded: true } },
              { session },
            ),
          );
          saleFolded = true;
          const documents = entryDocuments(
            orderId,
            merged.commissions,
            merged.decidedAt,
            'sale',
          );
          if (documents.length > 0) {
            yield* promise(() => ledger.insertMany(documents, { session }));
          }
          folded = documents.length;
        }

        // The reversal: the cancellation and the refund, both present — and
        // only after the sale, which it mirrors from the ledger.
        if (
          saleFolded &&
          merged.reversed !== true &&
          merged.cancelledAt !== undefined &&
          merged.refundedAt !== undefined
        ) {
          const refundedAt = merged.refundedAt;
          yield* promise(() =>
            sales.updateOne(
              { orderId },
              { $set: { reversed: true } },
              { session },
            ),
          );
          const lines = (yield* promise(() =>
            ledger.find({ orderId, kind: 'sale' }, { session }).toArray(),
          )) as unknown as LedgerLine[];
          const documents = entryDocuments(
            orderId,
            lines.map(reversalOf),
            refundedAt,
            'reversal',
          );
          if (documents.length > 0) {
            yield* promise(() => ledger.insertMany(documents, { session }));
          }
          reversed = documents.length;
        }

        return (
          folded > 0 || reversed > 0
            ? { kind: 'written', folded, reversed }
            : { kind: 'waiting' }
        ) as FoldOutcome;
      });

    const settle = (
      session: ClientSession,
      periodStart: Date,
      periodEnd: Date,
    ) =>
      Effect.gen(function* () {
        const runId = globalThis.crypto.randomUUID();
        const entries = db.collection<LedgerLine>(COMMISSION_ENTRY_COLLECTION);
        const runDocument = (status: 'calculated' | 'cancelled') => {
          const run = new SettlementRun(periodStart, periodEnd);
          run.id = runId;
          run.status = status;
          return { ...serializeEntity(SettlementRun, run), id: runId };
        };

        const claimed = yield* promise(() =>
          entries.updateMany(
            {
              runId: { $exists: false },
              occurredAt: { $gte: periodStart, $lte: periodEnd },
            },
            { $set: { runId } },
            { session },
          ),
        );
        if (claimed.modifiedCount === 0) {
          // A sibling sweep took them first: record the empty attempt rather
          // than leave it unexplained.
          yield* promise(() =>
            db
              .collection(SETTLEMENT_RUN_COLLECTION)
              .insertOne(runDocument('cancelled'), { session }),
          );
          return undefined;
        }

        const rows = yield* promise(() =>
          entries.find({ runId }, { session }).toArray(),
        );
        const byVendor = new Map<string, LedgerLine[]>();
        for (const row of rows) {
          byVendor.set(row.vendorId, [
            ...(byVendor.get(row.vendorId) ?? []),
            row,
          ]);
        }
        // A payout is the gross less the cut, and may be negative: a claw-back
        // against the vendor's next period, allowed rather than clamped.
        // ⚠️ `forEach`, never a spread of the `Map`: swc's `loose` spread turns
        // `[...map]` into the iterator's internals, and every run then failed.
        const payouts: Record<string, unknown>[] = [];
        byVendor.forEach((lines, vendorId) => {
          const { amount, currency } = payoutFor(vendorId, lines);
          const payout = new VendorPayout(runId, vendorId, amount, currency);
          payout.id = globalThis.crypto.randomUUID();
          payouts.push({
            ...serializeEntity(VendorPayout, payout),
            id: payout.id,
          });
        });
        yield* promise(() =>
          db
            .collection(VENDOR_PAYOUT_COLLECTION)
            .insertMany(payouts, { session }),
        );
        yield* promise(() =>
          db
            .collection(SETTLEMENT_RUN_COLLECTION)
            .insertOne(runDocument('calculated'), { session }),
        );
        return {
          kind: 'calculated',
          runId,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          payouts: payouts.length,
          entries: rows.length,
        } as const;
      });

    return Layer.mergeAll(
      Layer.succeed(SaleJoinTag, {
        agreementsFor,
        contribute: (claim, orderId, half) =>
          Effect.map(
            units.run(
              unit =>
                fold(
                  unit.handle.session,
                  orderId,
                  half as Record<string, unknown>,
                ),
              {
                claim: { kind: 'event', ...claim },
              },
            ),
            outcome =>
              outcome._tag === 'committed'
                ? outcome.value
                : ({ kind: 'duplicate' } as FoldOutcome),
          ),
      }),
      Layer.succeed(SettlementRunStoreTag, {
        settleOnce: () =>
          Effect.gen(function* () {
            const oldest = yield* promise(() =>
              db
                .collection<LedgerLine>(COMMISSION_ENTRY_COLLECTION)
                .find({ runId: { $exists: false } })
                .sort({ occurredAt: 1 })
                .limit(1)
                .toArray(),
            );
            const first = oldest[0];
            if (first === undefined) return { kind: 'idle' } as RunOutcome;

            const outcome = yield* units.run(
              unit =>
                Effect.tap(
                  settle(unit.handle.session, first.occurredAt, new Date()),
                  run =>
                    Effect.sync(() => {
                      if (run === undefined) return;
                      const completed = {
                        runId: run.runId,
                        periodStart: run.periodStart,
                        periodEnd: run.periodEnd,
                        payouts: run.payouts,
                        completedAt: new Date().toISOString(),
                      };
                      unit.emit({
                        name: 'settlement.run.completed',
                        id: `${run.runId}:completed`,
                        source,
                        at: completed.completedAt,
                        correlationId: run.runId,
                        aggregate: { type: 'settlement-run', id: run.runId },
                        version: 1,
                        data: completed,
                      });
                    }),
                ),
              { afterCommit },
            );
            // A unit with no claim can only commit or fail.
            const run = (outcome as { readonly value: RunOutcome | undefined })
              .value;
            return run ?? ({ kind: 'idle' } as RunOutcome);
          }),
      }),
    );
  }),
);
