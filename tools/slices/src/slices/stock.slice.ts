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
 * Declared as its own slice from the start, ahead of any process, because the
 * reservation path is the one part of this system with a genuinely different
 * scale profile — every checkout writes it, while catalog authoring is
 * occasional. Recording the ownership now is what makes lifting it out later a
 * matter of pointing `deployments` at a new app instead of untangling a
 * database.
 *
 * Its reservation endpoint is the one place a platform-plane caller reaches a
 * tenant store, and it cannot resolve the organization from the session — a
 * buyer holds none, and the vendor comes from the item. That crossing is
 * ADR 0023's, and it is authorized by a service token plus a narrow permission,
 * never by the absence of a check.
 */
export const stockSlice: SliceDeclaration = {
  name: 'stock',
  status: 'planned',
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
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: [
    'GET /api/stock-item',
    'POST /api/stock-movement',
    'POST /api/reservation',
    'DELETE /api/reservation/:id',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscribedEvents: [],
};
