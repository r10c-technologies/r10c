import type { SliceDeclaration } from '../types.js';

/**
 * How a vendor sells: the channels a sale can originate through.
 *
 * The slice exists because the platform had exactly one implicit channel — the
 * marketplace storefront — and no vocabulary to say so, which left a vendor
 * selling in their own shop with nowhere to record it
 * ([ADR 0024](../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * What it deliberately does **not** own is the order. TM Forum models an
 * in-store sale as a channel on the same `ProductOrder` rather than a second
 * kind of order, so a counter sale is captured by the `order` slice through its
 * existing `POST /api/product-order` and pays through the `payment` slice
 * unchanged. This slice adds a vocabulary those two reference by a denormalized
 * copy; it is not a parallel sales pipeline, and it is not a second writer of
 * anything.
 *
 * That is also why there is no crossing here. A vendor at a counter never writes
 * the platform-plane `order` store directly — it calls the owning slice — so
 * "a slice writes only the stores it owns" holds without amendment, and
 * ADR 0023's mechanism stays the single named path it was written to be.
 *
 * **Tenant plane**, because a channel is per-vendor and never merges. The
 * inverse of `catalog-reference`, which is platform plane precisely because a
 * marketplace has to merge brands and categories into one browse tree.
 *
 * Its own store rather than a corner of `catalog`: two domains in one store is a
 * binding, and a vendor's channel configuration has no reason to be permanently
 * welded to their product catalog.
 */
export const salesSlice: SliceDeclaration = {
  name: 'sales',
  status: 'planned',
  domains: ['sales-management'],
  stores: [
    {
      name: 'sales',
      plane: 'tenant',
      hosts: ['sales-management'],
      partitioning: 'per-organization',
      truth: 'system-of-record',
    },
  ],
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: [
    'GET /api/sales-channel{,/:id}',
    'POST|PUT|DELETE /api/sales-channel',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscribedEvents: [],
};
