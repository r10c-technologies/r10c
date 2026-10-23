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
 * The ids are **generated to match** what marketplace-service seeds — the same
 * `product-brand-N` / `product-category-N` shape, over the same 20 brands and 50
 * categories. That is deliberately a convention rather than a foreign key the
 * database enforces: a cross-store constraint is exactly the coupling the store
 * split exists to prevent, and a dangling reference here is a display gap, not a
 * corrupt record.
 */
export interface ProductSpecificationRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  brandId: string;
  categoryId: string;
  /** Absent on odd-numbered specifications — see {@link mediaOf}. */
  media?: { url: string; alt: string }[];
}

/** Mirrors the pools marketplace-service seeds; see the note above. */
const BRAND_COUNT = 20;
const CATEGORY_COUNT = 50;

/**
 * Ten families of six. The repeated family word is what makes a substring
 * filter meaningful — the e2e RSQL suite matches on it — and the trailing number
 * is what makes a sort assertion stable.
 */
const FAMILIES = [
  'Widget',
  'Gizmo',
  'Sprocket',
  'Cog',
  'Lever',
  'Piston',
  'Valve',
  'Gasket',
  'Bearing',
  'Flange',
];

/**
 * Pictures for the even-numbered specifications, and **none** for the odd ones,
 * so the storefront always has both a card with an image and one without to
 * render ([ADR 0061](../../../docs/adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
 *
 * External `https` references, never uploads: the seed stores a URL exactly as
 * a vendor would. `picsum.photos/seed/<key>` answers the same picture for the
 * same key, so a reset lab shows the same catalog every time.
 */
const mediaOf = (
  number: number,
  name: string,
): Pick<ProductSpecificationRecord, 'media'> =>
  number % 2 === 0
    ? {
        media: [1, 2].map(view => ({
          url: `https://picsum.photos/seed/product-${number}-${view}/800/800`,
          alt: `${name}, view ${view}`,
        })),
      }
    : {};

/**
 * Temporary, in-memory mock dataset. 60 specifications, each naming a brand and
 * a category by id. Not a production source.
 */
export const productTempData: ProductSpecificationRecord[] = Array.from(
  { length: 60 },
  (_, index) => {
    const number = index + 1;
    const brandNumber = (index % BRAND_COUNT) + 1;
    const categoryNumber = (index % CATEGORY_COUNT) + 1;
    const family = FAMILIES[index % FAMILIES.length];
    const withinFamily = Math.floor(index / FAMILIES.length) + 1;
    return {
      id: `product-${number}`,
      code: `P-${String(number).padStart(4, '0')}`,
      name: `${family} ${withinFamily}`,
      description: `${family} #${withinFamily}`,
      brandId: `product-brand-${brandNumber}`,
      categoryId: `product-category-${categoryNumber}`,
      ...mediaOf(number, `${family} ${withinFamily}`),
    };
  },
);
