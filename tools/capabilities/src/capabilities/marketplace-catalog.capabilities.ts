import type { Capability } from '../types.js';

// The storefront filters by the buyer's phone (plan 1.17, #641).
export const marketplaceCatalogCapabilities: readonly Capability[] = [
  {
    id: 'marketplace-catalog:published-offering:filter-by-device',
    oda: 'TMFC001',
    entities: [
      'marketplace-catalog:published-offering',
      'catalog-reference:device-model',
    ],
    permissions: [],
    screens: ['storefront:category', 'storefront:search'],
    status: 'implemented',
    member: 'fitsDeviceModelIds',
    verticals: ['phone-accessories'],
  },
];
