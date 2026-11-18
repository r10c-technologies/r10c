import type { Capability } from '../types.js';

export const orderManagementCapabilities: readonly Capability[] = [
  // The storefront checkout: no verb and no session permission. An anonymous
  // buyer starts the `checkout` recipe, which runs behind a crossing permission
  // no role holds (ADR 0080 §1).
  {
    id: 'order-management:checkout-group:checkout',
    oda: 'TMFC002',
    entities: [
      'order-management:checkout-group',
      'order-management:product-order',
      'payment-management:payment',
      'stock-management:reservation',
      'shipping-order-management:shipping-order',
    ],
    permissions: ['order-management:product-order:write'],
    screens: [
      'storefront:cart',
      'storefront:checkoutReview',
      'storefront:orderStatus',
    ],
    status: 'implemented',
    verticals: 'all',
  },
  // "Find my order" (ADR 0076 §6): a crossing only the storefront's own token
  // opens. The mailed link it sends is redeemed on the access page.
  {
    id: 'order-management:checkout-group:send-access-link',
    oda: 'TMFC002',
    entities: ['order-management:checkout-group'],
    permissions: ['order-management:checkout-group:send-access-link'],
    screens: ['storefront:orderFind', 'storefront:orderAccess'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'order-management:product-order:cancel',
    oda: 'TMFC002',
    entities: ['order-management:product-order'],
    permissions: ['order-management:product-order:cancel'],
    screens: ['operation:product-order'],
    status: 'implemented',
    verticals: 'all',
  },
  // Planned (ADR 0081, plan 4.7): an order waits for a payment the seller
  // confirms, and a receipt is a file.
  {
    id: 'order-management:product-order:set-payment-link',
    oda: 'TMFC002',
    entities: ['order-management:product-order'],
    permissions: ['order-management:product-order:set-payment-link'],
    screens: ['operation:product-order'],
    status: 'planned',
    verticals: 'all',
  },
  {
    id: 'order-management:product-order:attach-payment-evidence',
    oda: 'TMFC002',
    entities: ['order-management:product-order'],
    permissions: ['order-management:product-order:attach-payment-evidence'],
    screens: ['storefront:orderStatus'],
    status: 'planned',
    verticals: 'all',
  },
  {
    id: 'order-management:product-order:confirm-payment',
    oda: 'TMFC002',
    entities: ['order-management:product-order', 'payment-management:payment'],
    permissions: ['order-management:product-order:confirm-payment'],
    screens: ['operation:product-order'],
    status: 'planned',
    verticals: 'all',
  },
];
