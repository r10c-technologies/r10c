/**
 * The channels the `mock` profile serves.
 *
 * Deliberately the same rows sales-service seeds
 * (`apps/sales-service/src/sales-temp-data.ts`), so a journey naming
 * `Mostrador principal` reads the same story in either profile.
 *
 * Copied rather than imported: an e2e project reaching into another app's
 * source would couple two runtimes together, and this is fixture data — if the
 * two ever diverge the shared journeys fail, which is the signal we want.
 */
export const salesChannelSeed = [
  {
    id: 'sales-channel-storefront',
    name: 'Marketplace',
    type: 'storefront',
    status: 'active',
  },
  {
    id: 'sales-channel-counter',
    name: 'Mostrador principal',
    type: 'counter',
    status: 'active',
  },
];

/**
 * What the till can ring up: one offering the demo vendor publishes, priced
 * as the projection carries it. The price is display only — sales-service
 * re-prices every line from the projection — which is why the sale's body
 * the journey asserts carries none.
 */
export const publishedOfferingSeed = [
  {
    id: 'published-offering-1',
    offeringId: 'product-offering-1',
    vendorId: 'e2e-organization',
    name: 'Taza de cerámica',
    amount: 25,
    currency: 'GTQ',
    availableHint: true,
  },
];
