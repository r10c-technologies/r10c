import { Effect } from 'effect';

import type { Agreement } from '../entities/agreement';
import type { FoldOutcome, SaleHalf } from '../ports/settlement-ports';
import { reversalOf, type VendorCommission } from '../values/commission';
import type { SettlementPorts } from './settlement-store.contract';

interface Join {
  commissions?: readonly VendorCommission[];
  decidedAt?: string;
  cancelledAt?: string;
  refundedAt?: string;
  folded: boolean;
  reversed: boolean;
}

interface Line extends VendorCommission {
  readonly orderId: string;
  readonly kind: 'sale' | 'reversal';
  readonly occurredAt: string;
  runId?: string;
}

/**
 * A settlement store held in memory — the fold's join and the run's ledger
 * behind {@link SettlementPorts} — for the specs of whatever consumes them. It
 * runs `describeSettlementStoreContract`, so it folds and reverses on the
 * same conditions as the Mongo store.
 */
export const makeInMemorySettlementStore = (
  agreements: readonly Agreement[] = [],
): SettlementPorts => {
  const joins = new Map<string, Join>();
  const claims = new Set<string>();
  const ledger: Line[] = [];

  const linesFor = (
    orderId: string,
    commissions: readonly VendorCommission[],
    occurredAt: string,
    kind: Line['kind'],
  ) => {
    for (const commission of commissions) {
      ledger.push({ ...commission, orderId, kind, occurredAt });
    }
    return commissions.length;
  };

  const fold = (orderId: string, half: SaleHalf): FoldOutcome => {
    const join = Object.assign(
      joins.get(orderId) ?? { folded: false, reversed: false },
      half,
    );
    joins.set(orderId, join);
    let folded = 0;
    let reversed = 0;
    if (
      !join.folded &&
      join.commissions !== undefined &&
      join.decidedAt !== undefined
    ) {
      join.folded = true;
      folded = linesFor(orderId, join.commissions, join.decidedAt, 'sale');
    }
    if (
      join.folded &&
      !join.reversed &&
      join.cancelledAt !== undefined &&
      join.refundedAt !== undefined
    ) {
      join.reversed = true;
      const sold = ledger.filter(
        line => line.orderId === orderId && line.kind === 'sale',
      );
      reversed = linesFor(
        orderId,
        sold.map(reversalOf),
        join.refundedAt,
        'reversal',
      );
    }
    return folded > 0 || reversed > 0
      ? { kind: 'written', folded, reversed }
      : { kind: 'waiting' };
  };

  return {
    join: {
      agreementsFor: vendorIds =>
        Effect.sync(() => {
          const latest = new Map<string, Agreement>();
          const newestFirst = agreements
            .filter(agreement => vendorIds.includes(agreement.vendorId))
            .sort(
              (a, b) =>
                Number(b.effectiveFrom ?? 0) - Number(a.effectiveFrom ?? 0),
            );
          for (const agreement of newestFirst) {
            if (!latest.has(agreement.vendorId)) {
              latest.set(agreement.vendorId, agreement);
            }
          }
          return latest;
        }),
      contribute: ({ consumer, eventId }, orderId, half) =>
        Effect.sync(() => {
          const key = `${consumer}:${eventId}`;
          if (claims.has(key)) return { kind: 'duplicate' };
          claims.add(key);
          return fold(orderId, half);
        }),
    },
    runs: {
      settleOnce: () =>
        Effect.sync(() => {
          const unsettled = ledger
            .filter(line => line.runId === undefined)
            .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
          const oldest = unsettled[0];
          if (oldest === undefined) return { kind: 'idle' };
          const runId = globalThis.crypto.randomUUID();
          for (const line of unsettled) line.runId = runId;
          return {
            kind: 'calculated',
            runId,
            periodStart: oldest.occurredAt,
            periodEnd: new Date().toISOString(),
            payouts: new Set(unsettled.map(line => line.vendorId)).size,
            entries: unsettled.length,
          };
        }),
    },
  };
};
