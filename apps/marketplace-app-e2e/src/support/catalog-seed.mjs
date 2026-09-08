/**
 * What the `mock` profile's marketplace-service serves.
 *
 * Rows in the **entity wire shape**, keyed by `alias ?? name`, which is exactly
 * what a REST payload and a Mongo document are — so `makeEntityBackend`
 * deserializes them with the entities' own metadata and the fixture cannot
 * drift from the format the adapters parse.
 *
 * The names are the storefront's old fixtures', kept on purpose: the four
 * `*.mock.spec.ts` journeys were written against them and this change is about
 * where the data comes from, not what it says.
 *
 * ⚠️ Plain `.mjs`, not `.ts`. It is loaded by the msw preload beside it, which
 * plain Node runs before Next starts — see `server-mocks.mjs`.
 */

const PUBLISHED_AT = '2026-01-01T00:00:00.000Z';

export const BRAND_SEED = [
  { id: 'brand-aurora', code: 'AUR', name: 'Aurora' },
  { id: 'brand-terra', code: 'TER', name: 'Terra' },
  { id: 'brand-nimbus', code: 'NIM', name: 'Nimbus' },
];

export const CATEGORY_SEED = [
  { id: 'category-lighting', code: 'lighting', name: 'Lighting' },
  { id: 'category-tableware', code: 'tableware', name: 'Tableware' },
  { id: 'category-textiles', code: 'textiles', name: 'Textiles' },
];

/**
 * One published offering per row.
 *
 * `id` equals `offeringId` because that is what the projector writes — the
 * offering's own id, so republishing replaces the record rather than adding
 * one. Prices are **minor units**, the projection's convention.
 */
const offering = (slug, code, name, description, brandId, categoryId, amount) => ({
  id: slug,
  offeringId: slug,
  vendorId: 'demo-organization',
  name,
  description,
  code,
  brandId,
  categoryId,
  amount,
  currency: 'GTQ',
  availableHint: true,
  publishedAt: PUBLISHED_AT,
});

export const OFFERING_SEED = [
  offering(
    'offering-aurora-desk-lamp',
    'AUR-LAMP-01',
    'Aurora Desk Lamp',
    'Warm dimmable LED with a brushed aluminium arm.',
    'brand-aurora',
    'category-lighting',
    1999,
  ),
  offering(
    'offering-aurora-wall-sconce',
    'AUR-SCON-01',
    'Aurora Wall Sconce',
    'A low, indirect wash of light for a hallway or a stairwell.',
    'brand-aurora',
    'category-lighting',
    2499,
  ),
  offering(
    'offering-aurora-floor-lamp',
    'AUR-FLOOR-01',
    'Aurora Floor Lamp',
    'A tall reading lamp with a weighted base and a jointed arm.',
    'brand-aurora',
    'category-lighting',
    2999,
  ),
  offering(
    'offering-terra-ceramic-mug',
    'TER-MUG-01',
    'Terra Ceramic Mug',
    'Hand-glazed stoneware, 350ml, dishwasher safe.',
    'brand-terra',
    'category-tableware',
    3499,
  ),
  offering(
    'offering-terra-dinner-plate',
    'TER-PLAT-01',
    'Terra Dinner Plate',
    'A wide, shallow plate in the same glaze as the mug.',
    'brand-terra',
    'category-tableware',
    3999,
  ),
  offering(
    'offering-terra-serving-bowl',
    'TER-BOWL-01',
    'Terra Serving Bowl',
    'Deep enough for a salad, handsome enough to leave out.',
    'brand-terra',
    'category-tableware',
    4499,
  ),
  offering(
    'offering-nimbus-wool-throw',
    'NIM-THRW-01',
    'Nimbus Wool Throw',
    'Ethically sourced merino in an oversized weave.',
    'brand-nimbus',
    'category-textiles',
    4999,
  ),
  offering(
    'offering-nimbus-linen-cushion',
    'NIM-CUSH-01',
    'Nimbus Linen Cushion',
    'A washed-linen cover over a feather insert.',
    'brand-nimbus',
    'category-textiles',
    5499,
  ),
  offering(
    'offering-nimbus-cotton-blanket',
    'NIM-BLNK-01',
    'Nimbus Cotton Blanket',
    'A light waffle blanket for the months either side of winter.',
    'brand-nimbus',
    'category-textiles',
    5999,
  ),
];
