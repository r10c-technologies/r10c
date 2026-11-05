import { MongoClientTag } from '@entifix/mongo';
import { seedCollection } from '@r10c/shells-effect-service';
import type { SeededVendor } from '@r10c/utils-ts-fleet';
import { Effect } from 'effect';

import {
  offeringPriceTempDataFor,
  offeringTempDataFor,
} from './offering-temp-data';
import { productTempDataFor } from './product-temp-data';

const asRecords = (
  data: ReadonlyArray<object>,
): ReadonlyArray<Record<string, unknown>> =>
  data as ReadonlyArray<Record<string, unknown>>;

/**
 * Seeds the catalog collections (`product-specification`, `product-offering`
 * and `product-offering-price`) on first boot. Each collection name matches its
 * entity's `key`.
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
export const seedCatalog = (tenantDbName: string, vendor: SeededVendor) =>
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(tenantDbName);

    yield* seedCollection(
      db,
      'product-specification',
      asRecords(productTempDataFor(vendor)),
    );

    // The offering and its price, in the same tenant database and by the same
    // rule: the collection name is the entity's `key`.
    yield* seedCollection(
      db,
      'product-offering',
      asRecords(offeringTempDataFor(vendor)),
    );
    yield* seedCollection(
      db,
      'product-offering-price',
      asRecords(offeringPriceTempDataFor(vendor)),
    );
  });
