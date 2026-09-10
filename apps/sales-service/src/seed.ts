import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { SALES_CHANNEL_COLLECTION } from './sales-channel-index';
import { salesChannelTempData } from './sales-temp-data';

/**
 * Inserts a seed dataset into a collection when it is empty.
 *
 * The guard is per **collection** rather than per database, the shape
 * `seedStock` and `seedCatalog` use: a store that gains a second collection
 * later should seed that one on the next boot rather than staying empty because
 * the first one has rows.
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
 * Seeds the demo vendor's channels on first boot.
 *
 * The `sales` store is **tenant plane**, so this writes into one organization's
 * own database — `sales_<organizationId>`, a third database beside the catalog's
 * `tenant_<organizationId>` and stock's `stock_<organizationId>`. Same plane,
 * same partitioning, different stores with different writing slices, which is
 * what makes one-writer a property of the connection rather than of review
 * ([ADR 0020](../../../docs/adr/0020-stores-and-slices.md)). Mongo creates it
 * lazily on this first write.
 *
 * ⚠️ **A lab with no channel cannot ring up a sale at all**, because the till
 * asks for one and `POST /api/counter-sale` refuses without it. That is the
 * difference between this seed and stock's: stock's makes the lab *useful*,
 * this one makes a whole screen reachable.
 */
export const seedSales = (tenantDbName: string) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(tenantDbName);

    yield* seedCollection(
      db,
      SALES_CHANNEL_COLLECTION,
      asRecords(salesChannelTempData),
    );
  });
