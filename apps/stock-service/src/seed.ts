import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { STOCK_ITEM_COLLECTION } from './stock-item-index';
import { stockItemTempData, stockMovementTempData } from './stock-temp-data';

/** The movement ledger's collection, matching `@entity({ key })`. */
const STOCK_MOVEMENT_COLLECTION = 'stock-movement';

/**
 * Inserts a seed dataset into a collection when it is empty.
 *
 * The same shape marketplace-admin-service's `seedCatalog` uses, and for the
 * same reasons: the temp-data records are already in the entity wire shape, so
 * they insert verbatim and read back through the entifix deserializer, and the
 * guard is per **collection** rather than per database — a store that gained a
 * second collection later should seed that one on the next boot rather than
 * staying empty because the first one has rows.
 */
function seedCollection(
  db: Db,
  collectionName: string,
  data: ReadonlyArray<Record<string, unknown>>,
) {
  return Effect.gen(function* () {
    const collection = db.collection(collectionName);
    const count = yield* Effect.promise(() => collection.countDocuments());
    if (count === 0 && data.length > 0) {
      yield* Effect.promise(() =>
        collection.insertMany(data.map(item => ({ ...item }))),
      );
    }
  });
}

const asRecords = (
  data: ReadonlyArray<object>,
): ReadonlyArray<Record<string, unknown>> =>
  data as ReadonlyArray<Record<string, unknown>>;

/**
 * Seeds the demo vendor's stock positions on first boot.
 *
 * The `stock` store is **tenant plane**, so this writes into one organization's
 * own database — `stock_<organizationId>`, which is a different database from
 * the catalog's `tenant_<organizationId>` even though the two share a plane, a
 * partitioning and an engine. Mongo creates it lazily on this first write.
 *
 * ⚠️ **This seed belongs here and not to marketplace-admin-service**, which is
 * where the offering ids it hangs off are already in scope. A second slice
 * writing the `stock` store is the one-writer violation `@r10c/slices` exists
 * to catch, and the convenience would have bought a permanent coupling between
 * two stores that must never transact together anyway (ADR 0020).
 *
 * ⚠️ **The ledger is written, not just the fold.** `stock-movement` rows go in
 * alongside the `stock-item` rows whose `onHand` is their sum — computed in
 * `stock-temp-data.ts`, never typed out. A total seeded with no movements
 * behind it is the one state the reconciliation ADR 0010 requires can never
 * reproduce, so a seeded lab would be permanently unreconcilable and the job
 * that finds a bad `$inc` would have nothing to compare against.
 *
 * The two collections are seeded **in ledger-then-fold order** for readability
 * only: they are independent inserts under independent empty-checks, and a
 * crash between them re-seeds whichever one is still empty on the next boot.
 */
export const seedStock = (tenantDbName: string) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(tenantDbName);

    yield* seedCollection(
      db,
      STOCK_MOVEMENT_COLLECTION,
      asRecords(stockMovementTempData),
    );
    yield* seedCollection(
      db,
      STOCK_ITEM_COLLECTION,
      asRecords(stockItemTempData),
    );
  });
