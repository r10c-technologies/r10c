import { randomUUID } from 'node:crypto';

import {
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import { EntifixConnError, serializeEntity } from '@r10c/entifix-ts-core';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { Context, Duration, Effect, Fiber } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import { payoutFor } from '../fold/commission';
import { settlementRunCompletedEntry } from '../outbox';
import {
  COMMISSION_ENTRY_COLLECTION,
  SETTLEMENT_RUN_COLLECTION,
  VENDOR_PAYOUT_COLLECTION,
} from '../settlement-index';

/**
 * How often the sweep looks for unsettled commission entries, from
 * config-service.
 *
 * Configuration rather than a constant, for the reason the outbox relay's
 * ceiling is: nothing about it is baked into a broker declaration or an index,
 * so an edit is adopted on the next boot. Nothing about it is baked into the
 * *records* either — a run states the period it actually covered, so changing
 * the cadence does not invalidate what came before.
 */
export class SettlementRunIntervalMs extends Context.Tag(
  'SettlementRunIntervalMs',
)<SettlementRunIntervalMs, number>() {}

/** The stored shape of a ledger line, as the sweep reads it back. */
interface LedgerRow {
  readonly vendorId: string;
  readonly saleAmount: number;
  readonly commissionAmount: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

/** What one pass did, so a caller can answer with it and a daemon can log it. */
export type RunOutcome =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'calculated';
      readonly runId: string;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly payouts: number;
      readonly entries: number;
    };

const runDocument = (
  runId: string,
  periodStart: Date,
  periodEnd: Date,
  status: 'open' | 'calculated' | 'cancelled',
): Record<string, unknown> => {
  const run = new SettlementRun(periodStart, periodEnd);
  run.id = runId;
  run.status = status;
  return { ...serializeEntity(SettlementRun, run), id: runId };
};

const payoutDocument = (
  runId: string,
  vendorId: string,
  amount: number,
  currency: string,
): Record<string, unknown> => {
  const payout = new VendorPayout(runId, vendorId, amount, currency);
  payout.id = randomUUID();
  return { ...serializeEntity(VendorPayout, payout), id: payout.id };
};

/**
 * One settlement pass: everything unsettled up to now becomes a run.
 *
 * ⚠️ **Exported as a pass, and forked separately below.** A pass is assertable
 * and a daemon on an interval is not — the same split the saga sweeps make, and
 * what lets `POST /api/settlement-run` reuse it verbatim rather than reimplement
 * it.
 *
 * ⚠️ **The period is derived, not scheduled.** `periodStart` is the oldest
 * unsettled entry and `periodEnd` is now, so runs are contiguous by construction
 * and there is no calendar arithmetic to get wrong at a month boundary. A run
 * still records the boundaries it actually covered, so "the March run" stays
 * answerable — and changing the cadence does not invalidate what came before.
 *
 * ⚠️ **The claim is a conditional write over the entries, not a lock.** Two
 * replicas sweeping together both see unsettled lines and both open a run; the
 * `$set` of `runId` matches only lines that still carry none, so the second one
 * stamps nothing and settles its own run `cancelled`. The record being walked is
 * already the durable claim, which is the argument ADR 0055 made for the saga
 * resume sweep — and it means this slice needs no Redis.
 *
 * ⚠️ **An entry stamped by this run is read back inside the same transaction**
 * rather than trusted from the pre-claim read. The pre-claim read is what decided
 * a run was worth opening; the post-claim read is what this run actually owns,
 * and between them another replica may have taken some of them.
 */
export const settleOnce = (client: MongoClient, db: Db) =>
  Effect.tryPromise({
    try: async (): Promise<RunOutcome> => {
      const oldest = await db
        .collection<LedgerRow>(COMMISSION_ENTRY_COLLECTION)
        .find({ runId: { $exists: false } })
        .sort({ occurredAt: 1 })
        .limit(1)
        .toArray();

      const first = oldest[0];
      if (first === undefined) {
        return { kind: 'idle' };
      }

      const runId = randomUUID();
      const periodStart = first.occurredAt;
      const periodEnd = new Date();

      const session = client.startSession();
      try {
        let outcome: RunOutcome = { kind: 'idle' };
        await session.withTransaction(async () => {
          const claimed = await db
            .collection<LedgerRow>(COMMISSION_ENTRY_COLLECTION)
            .updateMany(
              {
                runId: { $exists: false },
                occurredAt: { $gte: periodStart, $lte: periodEnd },
              },
              { $set: { runId } },
              { session },
            );

          if (claimed.modifiedCount === 0) {
            // Another replica took every line between the read above and this
            // write. Its run is the real one; this is a run over nothing, and a
            // cancelled record is more honest than no record of the attempt.
            await db
              .collection(SETTLEMENT_RUN_COLLECTION)
              .insertOne(
                runDocument(runId, periodStart, periodEnd, 'cancelled'),
                { session },
              );
            outcome = { kind: 'idle' };
            return;
          }

          const rows = await db
            .collection<LedgerRow>(COMMISSION_ENTRY_COLLECTION)
            .find({ runId }, { session })
            .toArray();

          const byVendor = new Map<string, LedgerRow[]>();
          for (const row of rows) {
            const existing = byVendor.get(row.vendorId);
            if (existing === undefined) {
              byVendor.set(row.vendorId, [row]);
            } else {
              existing.push(row);
            }
          }

          // ⚠️ `byVendor.forEach`, deliberately not `[...byVendor].map(...)`.
          // Spreading a Map is broken in this bundle exactly as spreading a Set
          // is (see `uniqueVendors` in the fold): the entries come back as the
          // iterator's own objects rather than `[key, value]` pairs, so the
          // destructuring above yielded `undefined` for both and every run died
          // in `payoutFor` with nothing but "Failed to settle" to say why.
          // `forEach` hands the callback its arguments directly and needs no
          // iterator protocol.
          const payouts: Record<string, unknown>[] = [];
          byVendor.forEach((entries, vendorId) => {
            const { amount, currency } = payoutFor(vendorId, entries);
            payouts.push(payoutDocument(runId, vendorId, amount, currency));
          });

          if (payouts.length > 0) {
            await db
              .collection(VENDOR_PAYOUT_COLLECTION)
              .insertMany(payouts, { session });
          }

          await db
            .collection(SETTLEMENT_RUN_COLLECTION)
            .insertOne(
              runDocument(runId, periodStart, periodEnd, 'calculated'),
              { session },
            );

          // In the same transaction as the run it announces (ADR 0028). A crash
          // between the two would either tell the fleet about a run that rolled
          // back, or leave money owed with nothing downstream told.
          await settlementRunCompletedEntry(db, session, {
            runId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            payouts: payouts.length,
            completedAt: new Date().toISOString(),
          });

          outcome = {
            kind: 'calculated',
            runId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            payouts: payouts.length,
            entries: rows.length,
          };
        });
        return outcome;
      } finally {
        await session.endSession();
      }
    },
    catch: error =>
      new EntifixConnError('Failed to settle', error, { runId: '' }),
  });

/**
 * Fork the sweep as a detached daemon so it outlives the boot effect.
 *
 * `stop-intake` rather than `flush`: this sweep writes Mongo and enqueues an
 * outbox entry, so it has to stop before the client it writes through does — the
 * same phase, and the same reason, as the saga sweeps.
 *
 * A failed pass is logged and the daemon lives. A `findOne` that cannot reach
 * Mongo must not kill it, or the fleet silently stops settling until somebody
 * restarts the process — which is exactly the failure nobody notices, because
 * every probe stays green and sales keep completing.
 */
export const startSettlementSweep = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const interval = yield* SettlementRunIntervalMs;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = settleOnce(client, db).pipe(
    Effect.tap(outcome =>
      outcome.kind === 'calculated'
        ? Effect.logInfo('settled a period').pipe(
            Effect.annotateLogs({
              runId: outcome.runId,
              periodStart: outcome.periodStart,
              periodEnd: outcome.periodEnd,
              payouts: outcome.payouts,
              entries: outcome.entries,
            }),
          )
        : Effect.void,
    ),
    Effect.catchAll(error =>
      Effect.logError('settlement sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );

  const daemon = yield* Effect.forkDaemon(
    sweepOnce.pipe(Effect.delay(Duration.millis(interval)), Effect.forever),
  );

  yield* shutdown.register({
    name: 'settlement-sweep',
    phase: 'stop-intake',
    run: Fiber.interrupt(daemon).pipe(Effect.asVoid),
  });
});
