import type { SliceDeclaration } from '../types.js';

/**
 * Order capture: one checkout becomes one `ProductOrder`, whatever the basket
 * spans.
 *
 * The multi-vendor case rides on vendor-tagged embedded lines rather than on
 * splitting the order, so the buyer gets one receipt and settlement still
 * aggregates per vendor. The accepted cost is that "orders for vendor X" is a
 * query into an array rather than a top-level filter.
 *
 * The **cart is not a store**. It is a cookie, so the storefront's first
 * response is correct without a round trip — and so the fleet keeps zero
 * anonymous write surfaces.
 *
 * This slice is the reason ADR 0023 exists: it is platform plane, it must
 * reserve stock in a tenant store, and the buyer's session carries no
 * organization. `dependantAPIs` names that call explicitly, which is what a
 * split needs to know.
 */
export const orderSlice: SliceDeclaration = {
  name: 'order',
  status: 'planned',
  domains: ['order-management'],
  stores: [
    {
      name: 'order',
      plane: 'platform',
      hosts: ['order-management'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: ['GET|POST /api/product-order', 'GET /api/product-order/:id'],
  dependantAPIs: [
    'GET /api/config/:service',
    // The ADR 0023 crossing: explicit organizationId + service token.
    'POST /api/reservation',
    'DELETE /api/reservation/:id',
  ],
  publishedEvents: ['order.placed', 'order.cancelled'],
  subscribedEvents: ['payment.captured', 'payment.failed'],
};
