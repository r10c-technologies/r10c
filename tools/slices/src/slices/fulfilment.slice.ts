import type { SliceDeclaration } from '../types.js';

/**
 * Getting a vendor order to its buyer: dispatch, delivery or return, and the
 * cash a courier collects on delivery
 * ([ADR 0070](../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 *
 * **Planned.** It owns its store now so a boundary error shows up when the
 * entities land rather than when the service does. It claims
 * `shipping-order-management`, whose package (#482) declares the domain, and is
 * promoted to `active`, with `fulfilment-service` on `:3110`, by the commit that
 * writes the store (#483).
 */
export const fulfilmentSlice: SliceDeclaration = {
  name: 'fulfilment',
  status: 'planned',
  domains: ['shipping-order-management'],
  stores: [
    {
      name: 'fulfilment',
      plane: 'tenant',
      hosts: ['shipping-order-management'],
      partitioning: 'per-organization',
      truth: 'system-of-record',
    },
  ],
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: [],
  dependantAPIs: [],
  publishedEvents: [],
  subscriptions: [],
};
