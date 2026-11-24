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
      // Also carries the outbox and the specification code counter — neither an
      // `@entity()` class, so they add no host. They live here rather than in a
      // control-plane store so the entity write, the code it draws and the event
      // announcing it are one single-database transaction (ADR 0028).
      hosts: ['product-configuration-management'],
      partitioning: 'per-organization',
      truth: 'system-of-record',
    },
    // The saves' `Idempotency-Key` records (ADR 0068), in one database for
    // stock's reason: a key names no organization. Not entity records.
    {
      name: 'catalog-idempotency',
      plane: 'control',
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['marketplace-admin-service'],
  coDeployedWith: [],
  // Brand and category moved to the `marketplace` slice with ADR 0022: they are
  // platform reference data, not per-vendor rows, so this slice stopped serving
  // them rather than becoming a second writer.
  exposedAPIs: [
    'GET|POST /api/product-specification',
    'GET|PUT|DELETE /api/product-specification/:id',
    'GET /api/product-specification/$metadata',
    // A specification version's four lifecycle verbs (ADR 0079 §1), each its
    // own permission segment: a `PUT` reaches only a version in design.
    'POST /api/product-specification/:id/release',
    'POST /api/product-specification/:id/revise',
    'POST /api/product-specification/:id/retire',
    'POST /api/product-specification/:id/obsolete',
    'GET|POST /api/product-offering',
    'GET|PUT|DELETE /api/product-offering/:id',
    'GET /api/product-offering/$metadata',
    // The two declared verbs. They are their own routes rather than a status
    // field on the `PUT` above, because ADR 0026 gives each its own permission
    // segment — a route guarded by `write` would let anyone who can edit a
    // draft put it in front of buyers.
    'POST /api/product-offering/:id/publish',
    'POST /api/product-offering/:id/unpublish',
    'POST /api/product-offering/:id/set-sale-unit',
    // The same two verbs over a selection, under the same two permissions
    // (#216). One segment where the per-id routes have two, so neither shadows
    // the other.
    'POST /api/product-offering/publish',
    'POST /api/product-offering/unpublish',
    'GET|POST /api/product-offering-price',
    'GET|PUT|DELETE /api/product-offering-price/:id',
    'GET /api/product-offering-price/$metadata',
    // A price's volume tiers (ADR 0082 §8), a verb with its own form.
    'POST /api/product-offering-price/:id/set-price-tiers',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  // The `marketplace` slice consumes both to write the `published-catalog`
  // projection. The authoring slice emits and never writes that store — which
  // is how a projection keeps exactly one writer.
  //
  // Two names rather than one carrying a state member, and the consumer binds
  // them with a single `catalog.*` pattern so they share **one** queue and
  // therefore one delivery order. Two subscriptions would be two queues, two
  // independent orders, and a redelivered unpublication free to overtake a
  // newer publication.
  publishedEvents: ['catalog.published', 'catalog.unpublished'],
  subscriptions: [],
};
