import { Effect } from 'effect';

import type { Agreement } from '../entities/agreement';
import type { FoldOutcome, SaleHalf } from '../ports/settlement-ports';
import {
  type CollectedBy,
  reversalOf,
  type VendorCommission,
} from '../values/commission';
import type { SettlementPorts } from './settlement-store.contract';

interface Join {
  commissions?: readonly VendorCommission[];
  paymentMethod?: string;
  decidedAt?: string;
  captured?: number;
  collectedBy?: CollectedBy;
  cancelledAt?: string;
  refundedAt?: string;
  refunded?: number;
  folded: boolean;
  reversed: boolean;
  voided: boolean;
}

interface Line extends VendorCommission {
  readonly orderId: string;
  readonly kind: 'sale' | 'reversal';
  readonly occurredAt: string;
  readonly collectedBy: CollectedBy;
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
    collectedBy: CollectedBy,
  ) => {
    for (const commission of commissions) {
      ledger.push({ ...commission, orderId, kind, occurredAt, collectedBy });
    }
    return commissions.length;
  };

  const fold = (orderId: string, half: SaleHalf): FoldOutcome => {
    const join: Join = Object.assign(
      joins.get(orderId) ?? { folded: false, reversed: false, voided: false },
      half,
    );
    joins.set(orderId, join);
    // A cash-on-delivery order cancelled before its cash was collected: there
    // is nothing to settle and nothing to reverse, ever.
    if (
      !join.folded &&
      join.paymentMethod === 'cod' &&
      join.cancelledAt !== undefined &&
      join.decidedAt === undefined
    ) {
      join.voided = true;
    }
    if (join.voided) return { kind: 'voided' };
    let folded = 0;
    let reversed = 0;
    const collectedBy = join.collectedBy ?? 'platform';
    if (
      !join.folded &&
      join.commissions !== undefined &&
      join.decidedAt !== undefined
    ) {
      join.folded = true;
      folded = linesFor(
        orderId,
        join.commissions,
        join.decidedAt,
        'sale',
        collectedBy,
      );
    }
    if (
      join.folded &&
      !join.reversed &&
      join.cancelledAt !== undefined &&
      join.refundedAt !== undefined
    ) {
      join.reversed = true;
      // A refund half always carries its amount, and a folded sale its capture.
      const share = (join.refunded as number) / (join.captured as number);
      const sold = ledger.filter(
        line => line.orderId === orderId && line.kind === 'sale',
      );
      reversed = linesFor(
        orderId,
        sold.map(line => reversalOf(line, share)),
        join.refundedAt,
        'reversal',
        collectedBy,
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
    entries: () =>
      Effect.sync(() =>
        ledger.map(
          ({
            orderId,
            vendorId,
            kind,
            saleAmount,
            commissionAmount,
            collectedBy,
          }) => ({
            orderId,
            vendorId,
            kind,
            saleAmount,
            commissionAmount,
            collectedBy,
          }),
        ),
      ),
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
