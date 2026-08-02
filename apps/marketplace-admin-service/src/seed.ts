import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { productBrandTempData } from './product-brand-temp-data';
import { productCategoryTempData } from './product-category-temp-data';
import { productTempData } from './product-temp-data';

/**
 * Inserts a seed dataset into a collection when it is empty. The temp-data
 * records are already in the entity wire shape (product `brand` embedded,
 * `category` a foreign-key id), so they can be inserted verbatim and read back
 * through the entifix deserializer.
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
 * Seeds the catalog collections (`product-category`, `product-brand`,
 * `product`) on first boot. Collection names match each entity's `key`.
 *
 * The catalog is **tenant plane**: it belongs to the vendor that authored it,
 * not to the service. So the seed writes into one organization's own database
 * — the local demo vendor's — rather than into the service-wide one. That is
 * what makes the demo organization real isolation instead of a row nobody
 * reads: after a boot, these collections exist in `tenant_<organizationId>` and
 * are absent from the shared database.
 *
 * Mongo creates a database lazily on first write, so no provisioning step runs
 * ahead of this.
 */
export const seedCatalog = (tenantDbName: string) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(tenantDbName);

    yield* Effect.all(
      [
        seedCollection(
          db,
          'product-category',
          asRecords(productCategoryTempData),
        ),
        seedCollection(db, 'product-brand', asRecords(productBrandTempData)),
        seedCollection(db, 'product', asRecords(productTempData)),
      ],
      { discard: true },
    );
  });
