import type { SliceDeclaration } from '../types.js';

/**
 * Getting a vendor order to its buyer: dispatch, delivery or return, and the
 * cash a courier collects on delivery
 * ([ADR 0070](../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 *
 * **Active**, promoted by the commit that writes its store (#483):
 * fulfilment-service on `:3110` owns `fulfilment`, one Mongo database per
 * organization (`fulfilment_<organizationId>`), a fourth tenant store beside the
 * catalog's, stock's and sales'.
 *
 * A vendor's reads and verbs are a session bound to their organization; a
 * flow's steps — open, hold and release, withdraw, the dispatch pivot — are
 * crossings with the vendor named in a header, each on its own permission. A
 * move past dispatch announces itself from the organization's own outbox for the
 * delivery flow that waits on it (#488) and the vendor's open tabs.
 */
export const fulfilmentSlice: SliceDeclaration = {
  name: 'fulfilment',
  status: 'active',
  domains: ['shipping-order-management'],
  stores: [
    {
      name: 'fulfilment',
      plane: 'tenant',
      hosts: ['shipping-order-management'],
      partitioning: 'per-organization',
      truth: 'system-of-record',
    },
    // The crossing routes' `Idempotency-Key` records (ADR 0068), in one
    // database for stock's reason: a key names no organization.
    {
      name: 'fulfilment-idempotency',
      plane: 'control',
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['fulfilment-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET|POST /api/shipping-order',
    'GET /api/shipping-order/:id',
    'GET /api/shipping-order/$metadata',
    'POST|DELETE /api/shipping-order/:id/hold',
    'POST /api/shipping-order/:id/withdrawal',
    'POST /api/shipping-order/:id/dispatch-step',
    'POST /api/shipping-order/:id/dispatch',
    'POST /api/shipping-order/:id/record-delivery',
    'POST /api/shipping-order/:id/record-refusal',
    'POST /api/shipping-order/:id/record-return',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [
    'shipping-order.dispatched',
    'shipping-order.delivered',
    'shipping-order.refused',
    'shipping-order.returned',
  ],
  subscriptions: [],
};
