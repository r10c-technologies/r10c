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
  status: 'active',
  domains: ['product-configuration-management'],
  stores: [
    {
      name: 'catalog',
      plane: 'tenant',
      // Also carries the transaction outbox — not an `@entity()` class, so it
      // adds no host. It lives here rather than in a control-plane store so the
      // entity write and the event announcing it are one single-database
      // transaction (ADR 0028).
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
  // Brand and category moved to the `marketplace` slice with ADR 0022: they are
  // platform reference data, not per-vendor rows, so this slice stopped serving
  // them rather than becoming a second writer.
  exposedAPIs: ['GET|POST|PUT|DELETE /api/product-specification'],
  dependantAPIs: ['GET /api/config/:service'],
  // `catalog.published` is what the `marketplace` slice consumes to write the
  // `published-catalog` projection. The authoring slice emits and never writes
  // that store — which is how a projection keeps exactly one writer.
  publishedEvents: ['transaction.*', 'catalog.published'],
  subscriptions: [],
};
