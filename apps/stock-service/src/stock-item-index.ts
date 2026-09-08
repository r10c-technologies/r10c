import { StockItem } from '@r10c/business-ts-stock-management';
import { envelopeEntityName } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/** Mongo's duplicate-key error, however the driver wraps it. */
const DUPLICATE_KEY = 11_000;

export const STOCK_ITEM_COLLECTION = envelopeEntityName(StockItem);

/**
 * ⚠️ **The unique index is what makes one offering have one total.**
 *
 * `updateOne(..., { upsert: true })` is atomic *per document*; it is not a
 * guarantee that only one document ends up matching the filter. Concurrent
 * upserts each fail to see the other's uncommitted insert and each insert their
 * own — measured here, not theorized: 20 concurrent receipts for one offering
 * produced **nine** `StockItem` rows before this index existed, while the
 * ledger stayed perfectly correct at 20 rows summing to 20.
 *
 * That failure is worth understanding, because it is the one this whole design
 * is otherwise built to avoid. Nothing was lost and nothing was
 * read-modify-written — every `$inc` landed. What broke is the *identity* of the
 * fold: `availability()` reads one row, and with the total spread over nine of
 * them, the vendor sees a number that no single query can reconcile against a
 * ledger that is itself intact.
 *
 * Tenant databases appear on first write, so this is ensured per handle rather
 * than at boot, exactly as the catalog's outbox indexes are: there is no boot
 * moment at which every organization's database exists. `createIndex` is
 * idempotent, and the round trip is the price of not having a provisioning step
 * that can fail halfway.
 */
export const ensureStockItemIndexes = (db: Db) =>
  Effect.promise(() =>
    db
      .collection(STOCK_ITEM_COLLECTION)
      .createIndex({ offeringId: 1 }, { unique: true, name: 'offeringId_1' }),
  );

/**
 * Whether a write failed because it lost the upsert race above.
 *
 * With the unique index in place the loser of that race gets a duplicate-key
 * error rather than a second document, and the correct response is to try
 * again: the winner's document now exists, so the retry takes the *update*
 * branch and the increment lands. This is why the index alone is not the fix —
 * without the retry, one of two simultaneous receipts would be refused with a
 * `500` for no reason a vendor could act on.
 */
export const isDuplicateKeyError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, writeErrors } = error as {
    code?: unknown;
    writeErrors?: ReadonlyArray<{ code?: unknown }>;
  };
  return (
    code === DUPLICATE_KEY ||
    (Array.isArray(writeErrors) &&
      writeErrors.some(writeError => writeError.code === DUPLICATE_KEY))
  );
};
