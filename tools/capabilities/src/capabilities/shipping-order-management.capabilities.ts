import type { Capability } from '../types.js';

const SHIPPING_ORDER = 'shipping-order-management:shipping-order';

export const shippingOrderManagementCapabilities: readonly Capability[] = [
  {
    id: `${SHIPPING_ORDER}:dispatch`,
    oda: 'TMF700',
    entities: [SHIPPING_ORDER, 'order-management:product-order'],
    permissions: [
      `${SHIPPING_ORDER}:dispatch`,
      `${SHIPPING_ORDER}:dispatch-step`,
    ],
    screens: ['operation:shipping-order'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${SHIPPING_ORDER}:record-delivery`,
    oda: 'TMF700',
    entities: [SHIPPING_ORDER],
    permissions: [`${SHIPPING_ORDER}:record-delivery`],
    screens: ['operation:shipping-order'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${SHIPPING_ORDER}:record-refusal`,
    oda: 'TMF700',
    entities: [SHIPPING_ORDER],
    permissions: [`${SHIPPING_ORDER}:record-refusal`],
    screens: ['operation:shipping-order'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${SHIPPING_ORDER}:record-return`,
    oda: 'TMF700',
    entities: [SHIPPING_ORDER],
    permissions: [`${SHIPPING_ORDER}:record-return`],
    screens: ['operation:shipping-order'],
    status: 'implemented',
    verticals: 'all',
  },
  // Planned (ADR 0081): the vendor records the courier's guide before dispatch.
  {
    id: `${SHIPPING_ORDER}:record-guide`,
    oda: 'TMF700',
    entities: [SHIPPING_ORDER],
    permissions: [`${SHIPPING_ORDER}:record-guide`],
    screens: ['operation:shipping-order'],
    status: 'planned',
    verticals: 'all',
  },
];
