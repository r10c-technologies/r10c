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
