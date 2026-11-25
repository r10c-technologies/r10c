/**
 * The brand rows the `mock` profile serves.
 *
 * Deliberately the same shape and the same names as the seed the service
 * inserts (`apps/marketplace-service/src/product-brand-temp-data.ts` — brands
 * moved there with `catalog-reference` under ADR 0022): 20 brands cycling ten
 * base names, so `Acme` matches `Acme 1` and `Acme 2` in both profiles and one
 * spec suite can assert the same journeys against either.
 *
 * It is copied rather than imported: an e2e project reaching into another app's
 * source would couple two runtimes together, and this is fixture data — if the
 * two ever diverge, the shared journeys fail, which is the signal we want.
 */
const BASE_NAMES = [
  'Acme',
  'Globex',
  'Umbrella',
  'Initech',
  'Soylent',
  'Hooli',
  'Stark',
  'Wayne',
  'Wonka',
  'Cyberdyne',
];

/**
 * Categories and one product, for the journeys that go through the product form.
 *
 * Deliberately more categories than a picker's first page of suggestions, so a
 * spec that finds one by typing is proving the *search* rather than a lucky
 * position in a preloaded list.
 */
const numberedCategories = Array.from({ length: 14 }, (_, index) => {
  const number = index + 1;
  const baseName = BASE_NAMES[index % BASE_NAMES.length];

  return {
    id: `product-category-${number}`,
    code: `CAT-${number}`,
    // Per locale (#573): the back office reads `es` under `/es` and `en`
    // under `/en`, so the two differ where a spec needs to tell them apart.
    name: {
      es: `Herramientas ${baseName} ${number}`,
      en: `${baseName} tools ${number}`,
    },
    description: {
      es: `Todo lo que hace ${baseName} (#${number})`,
      en: `Everything ${baseName} makes (#${number})`,
    },
  };
});

/**
 * One category whose Spanish name carries an accent its English one does not:
 * a picker in `es` finds "Café" by typing "café", and `en` reads "Coffee"
 * (#565).
 */
export const categorySeed = [
  ...numberedCategories,
  {
    id: 'product-category-cafe',
    code: 'CAT-CAFE',
    name: { es: 'Café', en: 'Coffee' },
    description: {
      es: 'Café en grano y molido',
      en: 'Whole bean and ground coffee',
    },
  },
];

/**
 * Three, not one. The wizard's "duplicate an existing product" step is a table
 * the operator picks a row from, and a table with a single row proves nothing
 * about picking — a spec against it passes whichever row the click lands on.
 */
export const productSeed = [
  {
    id: 'product-1',
    code: 'P-1',
    // The first released version of its own series (ADR 0079 §1).
    specKey: 'P-1',
    version: 1,
    lifecycleStatus: 'active',
    name: 'Widget',
    description: 'A widget',
    // Plain ids into `catalog-reference`, another slice's store. They were an
    // embedded brand and a foreign-key category until ADR 0022 — the two wire
    // shapes a `link` could take — and nothing joins them now.
    brandId: 'product-brand-1',
    categoryId: 'product-category-1',
    // What the offering list's thumbnail and the product workspace's gallery
    // show (#558, #564). Served by the mock below, so no picture is fetched
    // from anywhere real.
    media: [
      {
        url: 'https://media.example.test/widget.png',
        alt: 'Un widget azul sobre fondo blanco',
      },
    ],
  },
  {
    id: 'product-2',
    code: 'P-2',
    specKey: 'P-2',
    version: 1,
    lifecycleStatus: 'active',
    name: 'Gadget',
    description: 'A gadget',
    brandId: 'product-brand-2',
    categoryId: 'product-category-2',
  },
  {
    id: 'product-3',
    code: 'P-3',
    specKey: 'P-3',
    version: 1,
    lifecycleStatus: 'active',
    name: 'Doohickey',
    description: 'A doohickey',
    brandId: 'product-brand-3',
    categoryId: 'product-category-3',
  },
  // A version still in design, so a spec that edits a product edits one the
  // service would let it save: a released one is read-only (ADR 0079 §1).
  {
    id: 'product-4',
    code: 'P-4',
    specKey: 'P-4',
    version: 1,
    lifecycleStatus: 'in-design',
    name: 'Gizmo',
    description: 'A gizmo',
    brandId: 'product-brand-1',
    categoryId: 'product-category-1',
  },
];

/**
 * The phones a product can fit (plan 1.17), as marketplace-service seeds a few
 * of them. One retired, which the wizard's picker must not offer.
 */
export const deviceModelSeed = [
  // Stated, as the service stores it: the picker asks for `status==active`.
  {
    id: 'device-model-1',
    name: 'Samsung Galaxy A15',
    maker: 'Samsung',
    status: 'active',
  },
  { id: 'device-model-2', name: 'iPhone 15', maker: 'Apple', status: 'active' },
  {
    id: 'device-model-3',
    name: 'Nokia 3310',
    maker: 'Nokia',
    status: 'retired',
  },
];

export const brandSeed = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const baseName = BASE_NAMES[index % BASE_NAMES.length];
  const slug = baseName.toLowerCase();

  return {
    id: `product-brand-${number}`,
    // The seeded rows carry no code, so neither do these.
    name: `${baseName} ${Math.floor(index / BASE_NAMES.length) + 1}`,
    description: `Products manufactured by ${baseName} (#${number})`,
    website: `https://www.${slug}.example.com`,
  };
});
