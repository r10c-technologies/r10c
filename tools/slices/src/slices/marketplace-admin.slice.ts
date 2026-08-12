import type { SliceDeclaration } from '../types.js';

/**
 * Vendor-facing catalog authoring, plus the saga coordination its transactional
 * writes need.
 *
 * `catalog` is the repo's only tenant-plane store: it is physically one Mongo
 * database per organization (`tenant_<organizationId>`), resolved inside the
 * request from the session. That is why this slice's composition root opens a
 * `MongoClientLayer` and names no database at boot — naming one would create a
 * database nothing ever writes.
 */
export const marketplaceAdminSlice: SliceDeclaration = {
  name: 'marketplace-admin',
  domains: ['product-configuration-management'],
  stores: [
    {
      name: 'catalog',
      plane: 'tenant',
      hosts: ['product-configuration-management'],
      partitioning: 'per-organization',
      truth: 'system-of-record',
    },
    {
      name: 'saga-coordination',
      plane: 'control',
      // Locks and code sequences over Redis — no entities, and deliberately not
      // the saga's own record, which is the `saga` store below.
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['marketplace-admin-service'],
  coDeployedWith: ['transaction'],
  exposedAPIs: [
    'GET|POST|PUT|DELETE /api/product',
    'GET|POST|PUT|DELETE /api/product-brand',
    'GET|POST|PUT|DELETE /api/product-category',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: ['transaction.*'],
  subscribedEvents: [],
};
