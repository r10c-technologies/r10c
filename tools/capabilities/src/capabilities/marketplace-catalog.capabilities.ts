import type { Capability } from '../types.js';

// In design (plan 1.17): the storefront filters by the buyer's phone.
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
    status: 'in-design',
    verticals: ['phone-accessories'],
  },
];
