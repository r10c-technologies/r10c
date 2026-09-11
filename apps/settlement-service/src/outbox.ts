import type { DomainEvent } from '@r10c/entifix-ts-core';
import {
  OUTBOX_COLLECTION,
  outboxDocument,
} from '@r10c/entifix-ts-mongo-client';
import type { ClientSession, Db } from 'mongodb';

/** The slice this process publishes as (ADR 0020's ownership noun). */
export const SETTLEMENT_SLICE = 'settlement';

/** What a completed run announces. */
export interface SettlementRunCompleted {
  readonly runId: string;
  /** ISO-8601, the boundaries the run selected its ledger lines by. */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** How many vendors it wrote a payout for. */
  readonly payouts: number;
  /** ISO-8601. When the fold finished, and the message's ordering key. */
  readonly completedAt: string;
}

/**
 * Announce a finished run, **in the caller's transaction**.
 *
 * ⚠️ **This is why the function takes a session**, and the rule is ADR 0028's:
 * the event is written to the outbox inside the same Mongo transaction as the
 * write it announces. Written separately, a crash between the two either tells
 * the fleet about a run that rolled back, or leaves a run finished that nobody
 * was told about — and the second is money owed with no downstream trigger.
 *
 * ⚠️ **The outbox lives in the `settlement` store**, for the reason every other
 * one lives in the store it announces: same database keeps the transaction
 * single-database and therefore single-shard.
 *
 * **Nothing consumes this yet, and it is published anyway.** The record is
 * required by ADR 0028 regardless, and an outbox nothing drains is a backlog
 * with no ceiling and no gauge — the defect #232 named. A payouts process is
 * what reads it, and that is not built.
 *
 * The id is `<runId>:completed` rather than the run id alone, the shape the
 * order's `<orderId>:placed` uses: one run may later emit a second message when
 * it is paid, and keying on the run alone would make that look like a redelivery
 * of this one.
 */
export const settlementRunCompletedEntry = async (
  db: Db,
  session: ClientSession,
  completed: SettlementRunCompleted,
): Promise<void> => {
  const event: DomainEvent<SettlementRunCompleted> = {
    name: 'settlement.run.completed',
    id: `${completed.runId}:completed`,
    source: SETTLEMENT_SLICE,
    at: completed.completedAt,
    correlationId: completed.runId,
    data: completed,
  };

  await db
    .collection(OUTBOX_COLLECTION)
    .insertOne(outboxDocument(event), { session });
};
