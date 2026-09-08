import type { SliceDeclaration } from '../types.js';

/**
 * The storefront's backend: the shared catalog vocabulary, and the published
 * catalog projected from every vendor's tenant storage.
 *
 * Two stores in one plane, and the pair is the point. `catalog-reference` is
 * **system-of-record** — brands, categories and dictionary terms, authored by
 * the operator — while `published-catalog` is `projection-of:catalog`. A store
 * carries exactly one `truth`, which is precisely why these are two stores and
 * therefore two domains rather than one "catalog" module.
 *
 * This slice is the **writer of the projection**, not the slice that authored
 * the offering. marketplace-admin emits `catalog.published`; this one consumes
 * it and writes its own store. That keeps the public read host out of tenant
 * storage entirely, which is what ADR 0009's isolation argument actually
 * requires — a platform-plane reader that could reach a tenant database would
 * delete the property the plane split exists for.
 *
 * It also settles the shape ADR 0020 predicted when it retired "plane-hosts" as
 * the topology axis: ownership is the axis, and a slice may own stores in more
 * than one plane.
 */
export const marketplaceSlice: SliceDeclaration = {
  name: 'marketplace',
  status: 'active',
  domains: ['catalog-reference', 'marketplace-catalog'],
  stores: [
    {
      name: 'catalog-reference',
      plane: 'platform',
      hosts: ['catalog-reference'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
    {
      name: 'published-catalog',
      plane: 'platform',
      hosts: ['marketplace-catalog'],
      partitioning: 'single',
      // Derived data, and never merged into: republishing replaces the record
      // wholesale, because a projection with a partial update path drifts from
      // its source in ways nothing detects.
      truth: 'projection-of:catalog',
    },
  ],
  deployments: ['marketplace-service'],
  coDeployedWith: [],
  // Reads are unauthenticated and writes are permission-gated: the storefront
  // serves anonymous traffic and must read the catalog without a session, while
  // only an operator authors the vocabulary. `published-offering` is read-only
  // over HTTP by construction — its only writer is the projector, and a POST
  // would be the second writer `truth: projection-of:` forbids.
  exposedAPIs: [
    'GET /api/published-offering{,/:id}',
    'GET /api/product-brand{,/:id}',
    'POST|PUT|DELETE /api/product-brand',
    'GET /api/product-category{,/:id}',
    'POST|PUT|DELETE /api/product-category',
    'GET /api/dictionary-term{,/:id}',
    'POST|PUT|DELETE /api/dictionary-term',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscriptions: [
    // Work: the projection is this slice's system of record for the published
    // catalog, so a message lost while it restarts is an offering the
    // storefront never shows and nothing can notice.
    {
      // One pattern, both names — so publications and unpublications share a
      // queue and therefore an order. `x-delivery-limit` and the queue name are
      // immutable once the queue exists, so this is settled here or by a
      // `dev:reset`.
      event: 'catalog.*',
      mode: 'work',
      maxAttempts: 5,
      dedupe: 'natural',
      dedupeReason:
        'A publication is a full-document upsert keyed on the offering id, so ' +
        're-applying one writes the same document. An unpublication is a ' +
        'delete, which is idempotent but NOT order-free — so the projector ' +
        'compares the event`s publishedAt against the stored record and ' +
        'ignores anything older. Without that guard a redelivered ' +
        'unpublication could remove a listing a newer publication had just ' +
        'restored, permanently and with every probe green.',
    },
  ],
};
