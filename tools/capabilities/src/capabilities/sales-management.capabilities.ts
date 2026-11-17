import type { Capability } from '../types.js';

export const salesManagementCapabilities: readonly Capability[] = [
  {
    id: 'sales-management:sales-channel:sell',
    oda: null,
    entities: [
      'sales-management:sales-channel',
      'order-management:product-order',
    ],
    permissions: ['sales-management:sales-channel:sell'],
    screens: ['wizard:counter-sale'],
    status: 'implemented',
    verticals: 'all',
  },
];
