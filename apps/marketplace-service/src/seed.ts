import { MongoDatabaseTag } from '@entifix/mongo';
import { seedCollection } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { dictionaryTermTempData } from './dictionary-term-temp-data';
import { productBrandTempData } from './product-brand-temp-data';
import { productCategoryTempData } from './product-category-temp-data';

const asRecords = (
  data: ReadonlyArray<object>,
): ReadonlyArray<Record<string, unknown>> =>
  data as ReadonlyArray<Record<string, unknown>>;

/**
 * Seeds the `catalog-reference` store on first boot. Collection names match each
 * entity's `key`.
 *
 * Unlike the catalog's seed, this writes into the service's **own** named
 * database rather than a tenant's. That is the whole difference between the two
 * stores: reference data is platform plane and shared by every vendor, so there
 * is no organization to resolve a handle from — which is also why this service
 * opens `MongoDatabaseLayer` and marketplace-admin-service opens
 * `MongoClientLayer`.
 */
export const seedCatalogReference = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;

  yield* Effect.all(
    [
      seedCollection(db, 'dictionary-term', asRecords(dictionaryTermTempData)),
      seedCollection(db, 'product-brand', asRecords(productBrandTempData)),
      seedCollection(
        db,
        'product-category',
        asRecords(productCategoryTempData),
      ),
    ],
    { discard: true },
  );
});
