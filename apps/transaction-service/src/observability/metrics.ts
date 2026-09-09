import type { TransactionState } from '@r10c/entifix-transactions';
import { Effect, Metric } from 'effect';

/**
 * The transaction half of ADR 0001's first metric set.
 *
 * It moved here with the `saga` store's owner (#229): the outbox half stayed in
 * marketplace-admin-service, because the outbox is a `catalog` collection — one
 * per `tenant_<id>` database — and `catalog` is the marketplace-admin slice's
 * store, not this one's (`docs/_shared/planes.md`).
 *
 * ⚠️ The metric object is **exported so a reader uses the same instance**. An
 * Effect metric's registry key includes its description, so rebuilding one by
 * name without the description addresses a different series that is permanently
 * zero — a silent way to write a query against nothing.
 *
 * ⚠️ **A dimensionless gauge reaches Prometheus with a `_ratio` suffix.** That
 * is the OTel exporter's convention for unit `1`, not a mistake here, so
 * `transactions_by_state` is queried as `transactions_by_state_ratio`.
 */

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
