import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { productTempData } from './product-temp-data';

/**
 * Inserts a seed dataset into a collection when it is empty. The temp-data
 * records are already in the entity wire shape — `brandId` and `categoryId` are
 * plain ids into `catalog-reference`, a store this service does not own — so
 * they insert verbatim and read back through the entifix deserializer.
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
 * Seeds the catalog collection (`product-specification`) on first boot. The
 * collection name matches the entity's `key`.
 *
 * The catalog is **tenant plane**: it belongs to the vendor that authored it,
 * not to the service. So the seed writes into one organization's own database
 * — the local demo vendor's — rather than into the service-wide one. That is
 * what makes the demo organization real isolation instead of a row nobody
 * reads: after a boot, this collection exists in `tenant_<organizationId>` and
 * is absent from the shared database.
 *
 * Brands and categories are **not** seeded here any more. They are platform
 * reference data now, owned by the `marketplace` slice, and seeding them from a
 * tenant handle would make this service a second writer of another slice's
 * store (ADR 0022).
 *
 * Mongo creates a database lazily on first write, so no provisioning step runs
 * ahead of this.
 */
export const seedCatalog = (tenantDbName: string) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(tenantDbName);

    yield* seedCollection(
      db,
      'product-specification',
      asRecords(productTempData),
    );
  });
