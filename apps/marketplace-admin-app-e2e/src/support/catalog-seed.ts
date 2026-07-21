/**
 * The brand rows the `mock` profile serves.
 *
 * Deliberately the same shape and the same names as the catalog seed the
 * service inserts (`apps/marketplace-admin-service/src/product-brand-temp-data.ts`):
 * 20 brands cycling ten base names, so `Acme` matches `Acme 1` and `Acme 2` in
 * both profiles and one spec suite can assert the same journeys against either.
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

export const brandSeed = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const baseName = BASE_NAMES[index % BASE_NAMES.length];
  const slug = baseName.toLowerCase();

  return {
    id: `product-brand-${number}`,
    // The service assigns codes through the create transaction; the seeded
    // rows carry none, so neither do these.
    name: `${baseName} ${Math.floor(index / BASE_NAMES.length) + 1}`,
    description: `Products manufactured by ${baseName} (#${number})`,
    website: `https://www.${slug}.example.com`,
  };
});
