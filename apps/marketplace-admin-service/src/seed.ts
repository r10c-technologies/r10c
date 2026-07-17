import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';

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
  collectionName: string,
  data: ReadonlyArray<Record<string, unknown>>
) {
  return Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const collection = db.collection(collectionName);
    const count = yield* Effect.promise(() => collection.countDocuments());
    if (count === 0 && data.length > 0) {
      yield* Effect.promise(() =>
        collection.insertMany(data.map((item) => ({ ...item })))
      );
    }
  });
}

/**
 * Seeds the catalog collections (`product-category`, `product-brand`,
 * `product`) on first boot. Collection names match each entity's `key`.
 */
const asRecords = (
  data: ReadonlyArray<object>
): ReadonlyArray<Record<string, unknown>> =>
  data as ReadonlyArray<Record<string, unknown>>;

export const seedCatalog = Effect.all(
  [
    seedCollection('product-category', asRecords(productCategoryTempData)),
    seedCollection('product-brand', asRecords(productBrandTempData)),
    seedCollection('product', asRecords(productTempData)),
  ],
  { discard: true }
);
