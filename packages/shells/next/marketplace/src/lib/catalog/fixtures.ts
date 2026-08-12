import type { SerializedEntity } from '@r10c/entifix-ts-core';

/**
 * The storefront's stand-in catalog, until marketplace-service exists.
 *
 * These are **plain records**, not instances, on purpose: an entity's
 * serialized form is keyed by `alias ?? name` in both directions, so a record
 * shaped like this is exactly what a REST payload or a SQL row would be. The
 * deserializer turns them into `Product`/`ProductBrand`/`ProductCategory`
 * instances using the entities' own metadata, which means the fixtures exercise
 * the same code path the real adapter will — including the accessor types and
 * the two link shapes.
 *
 * `brand` is **embedded** and `category` is a bare **id**, matching the
 * declarations on `Product`. That asymmetry is deliberate: it makes the
 * fixtures cover both halves of `loadProductsUCFactory`, which leaves an
 * already-loaded link alone and follows an id-only one through the resolver.
 */

export const BRAND_FIXTURES: SerializedEntity[] = [
  {
    id: 'brand-aurora',
    code: 'AUR',
    name: 'Aurora',
    description: 'Lighting and desk objects with a soft, warm character.',
    website: 'https://example.invalid/aurora',
  },
  {
    id: 'brand-terra',
    code: 'TER',
    name: 'Terra',
    description: 'Hand-finished stoneware and tableware.',
    website: 'https://example.invalid/terra',
  },
  {
    id: 'brand-nimbus',
    code: 'NIM',
    name: 'Nimbus',
    description: 'Textiles woven from responsibly sourced fibre.',
    website: 'https://example.invalid/nimbus',
  },
];

export const CATEGORY_FIXTURES: SerializedEntity[] = [
  {
    id: 'category-lighting',
    code: 'lighting',
    name: 'Lighting',
    description: 'Lamps, sconces and everything that throws light.',
  },
  {
    id: 'category-tableware',
    code: 'tableware',
    name: 'Tableware',
    description: 'Cups, plates and the things a table is set with.',
  },
  {
    id: 'category-textiles',
    code: 'textiles',
    name: 'Textiles',
    description: 'Throws, cushions and woven goods.',
  },
];

/** Keyed by brand id so a product can embed the whole record. */
function product(
  id: string,
  code: string,
  name: string,
  description: string,
  brandId: string,
  categoryId: string,
): SerializedEntity {
  return {
    id,
    code,
    name,
    description,
    // Plain ids into `catalog-reference`, another slice's store. They were an
    // embedded brand and a foreign-key category until ADR 0022; nothing joins
    // them now, so a page that wants a name asks that domain for it.
    brandId,
    categoryId,
  };
}

export const PRODUCT_FIXTURES: SerializedEntity[] = [
  product(
    'product-aurora-desk-lamp',
    'AUR-LAMP-01',
    'Aurora Desk Lamp',
    'Warm dimmable LED with a brushed aluminium arm.',
    'brand-aurora',
    'category-lighting',
  ),
  product(
    'product-aurora-wall-sconce',
    'AUR-SCON-01',
    'Aurora Wall Sconce',
    'A low, indirect wash of light for a hallway or a stairwell.',
    'brand-aurora',
    'category-lighting',
  ),
  product(
    'product-aurora-floor-lamp',
    'AUR-FLOOR-01',
    'Aurora Floor Lamp',
    'A tall reading lamp with a weighted base and a jointed arm.',
    'brand-aurora',
    'category-lighting',
  ),
  product(
    'product-terra-ceramic-mug',
    'TER-MUG-01',
    'Terra Ceramic Mug',
    'Hand-glazed stoneware, 350ml, dishwasher safe.',
    'brand-terra',
    'category-tableware',
  ),
  product(
    'product-terra-dinner-plate',
    'TER-PLAT-01',
    'Terra Dinner Plate',
    'A wide, shallow plate in the same glaze as the mug.',
    'brand-terra',
    'category-tableware',
  ),
  product(
    'product-terra-serving-bowl',
    'TER-BOWL-01',
    'Terra Serving Bowl',
    'Deep enough for a salad, handsome enough to leave out.',
    'brand-terra',
    'category-tableware',
  ),
  product(
    'product-nimbus-wool-throw',
    'NIM-THRW-01',
    'Nimbus Wool Throw',
    'Ethically sourced merino in an oversized weave.',
    'brand-nimbus',
    'category-textiles',
  ),
  product(
    'product-nimbus-linen-cushion',
    'NIM-CUSH-01',
    'Nimbus Linen Cushion',
    'A washed-linen cover over a feather insert.',
    'brand-nimbus',
    'category-textiles',
  ),
  product(
    'product-nimbus-cotton-blanket',
    'NIM-BLNK-01',
    'Nimbus Cotton Blanket',
    'A light waffle blanket for the months either side of winter.',
    'brand-nimbus',
    'category-textiles',
  ),
];
