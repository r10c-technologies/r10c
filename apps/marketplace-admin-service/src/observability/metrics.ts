import type { OutboxStats, TransactionState } from '@r10c/entifix-transactions';
import { Effect, Metric } from 'effect';

/**
 * The outbox and transaction halves of ADR 0001's first metric set.
 *
 * ⚠️ The metric objects are **exported so a reader uses the same instance**. An
 * Effect metric's registry key includes its description, so rebuilding one by
 * name without the description addresses a different series that is permanently
 * zero — a silent way to write a query against nothing.
 *
 * These are gauges rather than counters because they describe a *backlog*: the
 * question is how many are waiting right now, not how many there have ever
 * been. They are sampled by the two daemons that already run on an interval, so
 * nothing new is scheduled to produce them.
 */

/** Unsent, un-quarantined entries, per tenant database. */
export const outboxPending = Metric.gauge('outbox_pending_entries', {
  description: 'Unsent, un-quarantined outbox entries, by tenant database.',
});

/**
 * Age in seconds of the oldest unsent entry, per tenant database.
 *
 * **The metric that makes a stuck relay visible.** #179 gave the relay a
 * ceiling, so an entry that can never publish is quarantined and skipped rather
 * than blocking the head of the line forever — but that is reported only as a
 * log line, so how far behind the outbox has fallen is otherwise unanswerable.
 * A depth that is flat and an age that climbs is the signature of a relay whose
 * head has stopped moving.
 */
export const outboxOldestPendingAge = Metric.gauge(
  'outbox_oldest_pending_age_seconds',
  {
    description:
      'Age of the oldest unsent outbox entry, by tenant database. Zero when ' +
      'the outbox is empty.',
  },
);

/** Entries past the ceiling, which nothing retries and nothing deletes. */
export const outboxQuarantined = Metric.gauge('outbox_quarantined_entries', {
  description: 'Quarantined outbox entries, by tenant database.',
});

/**
 * Transaction records in each state.
 *
 * This is the reason `STALE` stops being something only a poll discovers: the
 * recovery sweep's entire action is to apply that label, and until it was
 * counted the label reached no event, no stream and no operator.
 */
export const transactionsByState = Metric.gauge('transactions_by_state', {
  description: 'Transaction records in each lifecycle state.',
});

/** Record one tenant outbox's depth and age. */
export const recordOutboxStats = (database: string, stats: OutboxStats) => {
  const tagged = (metric: Metric.Metric.Gauge<number>) =>
    Metric.tagged(metric, 'database', database);

  // Zero when nothing is waiting. The alternative — not reporting the series —
  // reads on most dashboards as "no data", which is indistinguishable from the
  // exporter having broken at exactly the moment a healthy relay looks idle.
  const ageSeconds =
    stats.oldestPendingAt === undefined
      ? 0
      : Math.max(0, (Date.now() - Date.parse(stats.oldestPendingAt)) / 1000);

  return Metric.set(tagged(outboxPending), stats.pending).pipe(
    Effect.andThen(Metric.set(tagged(outboxOldestPendingAge), ageSeconds)),
    Effect.andThen(Metric.set(tagged(outboxQuarantined), stats.quarantined)),
  );
};

/** Record the transaction store's per-state totals. */
export const recordTransactionStates = (
  counts: Record<TransactionState, number>,
) =>
  Effect.forEach(
    Object.entries(counts),
    ([state, count]) =>
      Metric.set(Metric.tagged(transactionsByState, 'state', state), count),
    { discard: true },
  );
