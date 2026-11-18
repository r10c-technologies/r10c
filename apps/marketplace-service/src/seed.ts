import { MongoDatabaseTag } from '@entifix/mongo';
import { revised, seedCollection } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { deviceModelTempData } from './device-model-temp-data';
import { dictionaryTermTempData } from './dictionary-term-temp-data';
import { productBrandTempData } from './product-brand-temp-data';
import { productCategoryTempData } from './product-category-temp-data';

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
      seedCollection(db, 'device-model', revised(deviceModelTempData)),
      seedCollection(db, 'dictionary-term', revised(dictionaryTermTempData)),
      seedCollection(db, 'product-brand', revised(productBrandTempData)),
      seedCollection(db, 'product-category', revised(productCategoryTempData)),
    ],
    { discard: true },
  );
});
