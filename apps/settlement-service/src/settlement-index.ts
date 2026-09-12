import {
  Agreement,
  CommissionEntry,
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { envelopeEntityName } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/** Each collection is its entity's own `@entity({ key })`, as everywhere else. */
export const AGREEMENT_COLLECTION = envelopeEntityName(Agreement);
export const COMMISSION_ENTRY_COLLECTION = envelopeEntityName(CommissionEntry);
export const SETTLEMENT_RUN_COLLECTION = envelopeEntityName(SettlementRun);
export const VENDOR_PAYOUT_COLLECTION = envelopeEntityName(VendorPayout);

/**
 * The indexes this store's reads and its two idempotency guards ride.
 *
 * ⚠️ **`(orderId, vendorId, kind)` on the commission ledger is unique, and it is
 * the fold's last line of defence.** The inbox claim already stops the *same*
 * message being folded twice; this stops two different messages — a redelivered
 * capture racing a redelivered placement, say — from both completing the join
 * and both writing. Losing that race is a duplicate-key error, which the handler
 * reads as "already folded" and acks, exactly as a duplicate claim is read.
 *
 * ⚠️ **`kind` is the third key, and without it a reversal is unwritable.** A
 * cancellation mirrors the sale's row for the same `(orderId, vendorId)` with
 * both signs flipped, which a two-key index refuses as a duplicate. One row per
 * pair **per kind** keeps the backstop unchanged in character while allowing the
 * one second row that is legitimate
 * ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md) §9).
 *
 * ⚠️ **The name changed with the keys, and a machine that has run this service
 * before must be reset.** Mongo refuses a `createIndex` reusing a name with
 * different keys, so `order_vendor_1` became `order_vendor_kind_1` — and the old
 * two-key index survives the rename and would refuse every reversal insert.
 * Nothing runs in production, so the shape changes and the lab resets
 * (`pnpm run back-office:dev:reset`); a drop-if-exists shim would be a migration
 * path written for an environment that does not exist.
 *
 * ⚠️ **`(vendorId, runId)` on the payout is unique for the mirror reason.** A run
 * writes one payout per vendor, and a resumed or re-entered run must find the
 * row it already wrote rather than adding a second one beside it.
 *
 * The rest are read paths: settling selects the ledger by period and unsettled
 * state, and a vendor-scoped list narrows every collection by `vendorId`.
 *
 * Ensured at boot rather than per handle, which a single named database can do
 * and a per-organization one cannot — the `settlement` store is control plane
 * and single, so there is exactly one database and it exists before the first
 * request.
 */
export const ensureSettlementIndexes = (db: Db) =>
  Effect.promise(async () => {
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
  });
