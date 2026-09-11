import type { SliceDeclaration } from '../types.js';

/**
 * What the platform owes each vendor, and on what terms.
 *
 * The one commerce slice whose store is **control** plane, and the difference is
 * not an oversight. A plane answers *who may read it*: an `Agreement` is the
 * platform's own record about a vendor — the same character as `Entitlement`,
 * and nothing like a public catalog. ADR 0020 explicitly allows a slice to own
 * stores in more than one plane, so the neighbours being platform plane is no
 * argument for putting this one there.
 *
 * Batch by nature — a settlement run is periodic and long-running, which is a
 * different shape from a request-path slice.
 *
 * > **Corrected 2026-09-10 by the commit that wrote the store.** This note used
 * > to call a run "the exact coarse operation `LockService` is for". It predates
 * > [ADR 0055](../../../docs/adr/0055-a-coordinator-resumes-from-its-own-record.md),
 * > which chose a conditional write over a distributed lock for the saga resume
 * > sweep, and the argument transfers: the `SettlementRun` being walked is
 * > already the durable record of intent, so claiming it with a conditional
 * > write needs no second datastore. This slice opens no Redis connection.
 *
 * **Promoted to `active` by the commit that wrote the store** (#153):
 * settlement-service on `:3107`.
 *
 * ⚠️ **It subscribes to two events and neither is sufficient alone.**
 * `payment.captured` says money moved and names the order; it carries no vendor
 * lines and only a channel *id*, which points into a tenant store this slice
 * cannot open. `order.placed` carries the vendor-tagged lines and the channel
 * *type* copied onto the receipt. The cut cannot be priced without both, so the
 * two are joined on the order id
 * ([ADR 0057](../../../docs/adr/0057-settlement-joins-the-sale-to-its-payment.md)).
 * This is the consumer ADR 0054 said `order.placed` was being drained for.
 */
export const settlementSlice: SliceDeclaration = {
  name: 'settlement',
  status: 'active',
  domains: ['settlement-management'],
  stores: [
    {
      name: 'settlement',
      plane: 'control',
      hosts: ['settlement-management'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['settlement-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET|POST|PUT /api/agreement',
    'GET /api/agreement/$metadata',
    'GET /api/commission-entry',
    'GET /api/commission-entry/$metadata',
    'GET|POST /api/settlement-run',
    'GET /api/settlement-run/$metadata',
    'GET /api/vendor-payout',
    'GET /api/vendor-payout/$metadata',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: ['settlement.run.completed'],
  // `inbox` on both: a settlement run accumulates, so folding one sale twice
  // overpays a vendor by its amount. A claim guards a *message*, and there are
  // two of them — one per queue, keyed `(consumer, eventId)`, so the two
  // consumers coexist in one database without either starving the other.
  subscriptions: [
    {
      event: 'order.placed',
      mode: 'work',
      maxAttempts: 5,
      dedupe: 'inbox',
    },
    {
      event: 'payment.captured',
      mode: 'work',
      maxAttempts: 5,
      dedupe: 'inbox',
    },
  ],
};
