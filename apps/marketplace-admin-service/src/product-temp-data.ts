import {
  SAMPLE_BRAND_IDS,
  SAMPLE_CATEGORY_IDS,
  sampleMediaPath,
  type SeededVendor,
} from '@r10c/utils-ts-fleet';

/**
 * A specification's brand and category are **plain ids** into
 * `catalog-reference`, which is a store this service does not own
 * ([ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * They used to be an embedded brand object and a foreign-key category, chosen to
 * exercise both link shapes the deserializer and link resolver had to handle
 * from one payload. Neither shape is available now: the targets live in another
 * plane, in another slice's store, and the `business:domain` tag forbids the
 * import that a typed link would need. Resolution goes through the owning
 * domain's port instead, and an id is what that port takes.
 *
 * The ids are **the same** ones marketplace-service seeds — both read
 * `SAMPLE_BRAND_IDS` and `SAMPLE_CATEGORY_IDS`. That is deliberately a convention rather than a foreign key the
 * database enforces: a cross-store constraint is exactly the coupling the store
 * split exists to prevent, and a dangling reference here is a display gap, not a
 * corrupt record.
 */
export interface ProductSpecificationRecord {
  id: string;
  code: string;
  /**
   * Every seeded product is the **first, released version** of its own series
   * (ADR 0079 §1): the key is its code, and it is `active` so the seeded
   * offerings that pin it are publishable — publishing refuses any other pin.
   * Released by the seed rather than by the verb, so it carries no content
   * hash; a version released through `release` always does.
   */
  specKey: string;
  version: number;
  lifecycleStatus: 'active';
  validFrom: Date;
  name: string;
  description: string;
  brandId: string;
  categoryId: string;
  media: { url: string; alt: string }[];
  /** What a phone accessory is made for (#641); absent elsewhere. */
  fitsDeviceModelIds?: string[];
}

/** When the seed released every product: one fixed moment, so a reset repeats it. */
const SEEDED_RELEASE = new Date('2026-01-01T00:00:00.000Z');

/**
 * One seeded store's specifications, from its sample catalog (#676), every id
 * under its `idPrefix` so the stores' catalogs stay apart once all are
 * published into one projection. A product's position is its number.
 *
 * Brand and category ids are **not** prefixed: they point into the one
 * platform vocabulary every store classifies against, and marketplace-service
 * seeds it from the same `SAMPLE_BRANDS` and `SAMPLE_CATEGORIES`.
 *
 * Every product has one picture, a drawing generated at build time and served
 * from the platform's own origin (ADR 0061, revised by #676) — never a third
 * party's host, so a lab with no internet shows the same catalog.
 */
export const productTempDataFor = (
  vendor: Pick<SeededVendor, 'idPrefix' | 'products' | 'slug'>,
): ProductSpecificationRecord[] =>
  vendor.products.map((product, index) => {
    const number = index + 1;
    const code = `P-${String(number).padStart(4, '0')}`;
    return {
      id: `${vendor.idPrefix}product-${number}`,
      code,
      specKey: code,
      version: 1,
      lifecycleStatus: 'active',
      validFrom: SEEDED_RELEASE,
      name: product.name,
      description: product.description,
      brandId: SAMPLE_BRAND_IDS[product.brand],
      categoryId: SAMPLE_CATEGORY_IDS[product.category],
      media: [{ url: sampleMediaPath(vendor, product), alt: product.name }],
      ...(product.fits === undefined
        ? {}
        : { fitsDeviceModelIds: [...product.fits] }),
    };
  });
