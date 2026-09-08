import type { SliceDeclaration } from '../types.js';

/**
 * Physical availability, per vendor.
 *
 * Its store is tenant plane and per-organization, exactly like the catalog's —
 * and deliberately **not** the same store. A product definition is owned by
 * product-configuration-management and a quantity by stock-management, so one
 * record written by two domains is the coupling the decomposition exists to
 * prevent. Physically that is `stock_<organizationId>` beside
 * `tenant_<organizationId>`: two database handles, which makes one-writer a
 * property of the connection rather than of review.
 *
 * Declared as its own slice ahead of any process, because the reservation path
 * is the one part of this system with a genuinely different scale profile —
 * every checkout writes it, while catalog authoring is occasional. Recording
 * the ownership early is what made promoting it a `deployments` edit rather
 * than a boundary negotiation.
 *
 * **Promoted to `active` by the commit that wrote the store** (#150): stock-service
 * on `:3108` records movements into the append-only ledger and folds them onto
 * `StockItem` with `$inc`, in one transaction.
 *
 * Its reservation endpoint is **not built yet**, and is deliberately not
 * declared here until it is. It is the one place a platform-plane caller
 * reaches a tenant store, and it cannot resolve the organization from the
 * session — a buyer holds none, and the vendor comes from the item. That
 * crossing is ADR 0023's, and it is authorized by a service token plus a narrow
 * permission, never by the absence of a check.
 */
export const stockSlice: SliceDeclaration = {
  name: 'stock',
  status: 'active',
  domains: ['stock-management'],
  stores: [
    {
      name: 'stock',
      plane: 'tenant',
      hosts: ['stock-management'],
      partitioning: 'per-organization',
      truth: 'system-of-record',
    },
  ],
  deployments: ['stock-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET /api/stock-item',
    'GET /api/stock-movement',
    'POST /api/stock-movement',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscriptions: [],
};
