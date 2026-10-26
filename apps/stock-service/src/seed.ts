import { MongoClientTag } from '@entifix/mongo';
import {
  ensureStockItemIndexes,
  MOVEMENT_COLLECTION,
  STOCK_ITEM_COLLECTION,
} from '@r10c/implementation-stock-mongo';
import { seedCollection } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { stockItemTempData, stockMovementTempData } from './stock-temp-data';

/** The movement ledger's collection, matching `@entity({ key })`. */
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

    // ⚠️ **The index, before the rows.** `ensureStockItemIndexes` otherwise runs
    // only inside the ledger's first write, which is fine while a movement is the
    // only thing that creates the collection — and stopped being true here.
    // Measured on the live lab: after a `dev:reset` the seeded
    // `stock_demo-organization` held 40 correct items and `stock-item` carried
    // `_id_` and nothing else, so the fold's uniqueness was unguaranteed until
    // somebody happened to record a movement.
    //
    // The collection exists from this write on, so this is the first moment the
    // index can be created at all; `createIndex` is idempotent, so the
    // per-request call stays exactly as it was.
    yield* ensureStockItemIndexes(db);

    yield* seedCollection(
      db,
      MOVEMENT_COLLECTION,
      asRecords(stockMovementTempData),
    );
    yield* seedCollection(
      db,
      STOCK_ITEM_COLLECTION,
      asRecords(stockItemTempData),
    );
  });
