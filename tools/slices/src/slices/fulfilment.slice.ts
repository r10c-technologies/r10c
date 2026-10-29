import type { SliceDeclaration } from '../types.js';

/**
 * Getting a vendor order to its buyer: dispatch, delivery or return, and the
 * cash a courier collects on delivery
 * ([ADR 0070](../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 *
 * **Planned.** It owns its store now so a boundary error shows up when the
 * entities land rather than when the service does. It claims no domain yet:
 * `shipping-order-management` is named here, in prose, until #482 writes the
 * package that declares it, because a slice may not claim a domain no package
 * declares. Promoted to `active`, with `fulfilment-service` on `:3110`, by the
 * commit that writes the store (#483).
 */
export const fulfilmentSlice: SliceDeclaration = {
  name: 'fulfilment',
  status: 'planned',
  domains: [],
  stores: [
    {
      name: 'fulfilment',
      plane: 'tenant',
      hosts: [],
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
