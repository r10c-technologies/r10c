import { SAMPLE_BRAND_IDS, SAMPLE_BRANDS } from '@r10c/utils-ts-fleet';

export interface ProductBrandRecord {
  id: string;
  name: string;
  description: string;
  website: string;
  status: 'active' | 'retired';
}

/**
 * The brands the three sample stores classify their products under (#676),
 * from `SAMPLE_BRANDS` — the list marketplace-admin-service's catalog seed
 * reads too, so a specification's `brandId` always names a row seeded here.
 *
 * Every brand is invented (ADR 0025), and one seeds **retired**, so the
 * retire verb has something to fail on out of the box: selecting a mixed
 * range and running it is what shows the per-row report doing its job.
 * Changing this needs a `dev:reset` — the seed only writes into an empty
 * collection.
 */
export const productBrandTempData: ProductBrandRecord[] = SAMPLE_BRANDS.map(
  ([key, brand]) => ({
    id: SAMPLE_BRAND_IDS[key],
    name: brand.name,
    description: brand.description,
    website: `https://${key}.example.com`,
    status: brand.retired ? 'retired' : 'active',
  }),
);
