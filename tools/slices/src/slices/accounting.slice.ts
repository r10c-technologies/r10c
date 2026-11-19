import type { SliceDeclaration, SubscriptionDeclaration } from '../types.js';

/** Every module subscription: a `work` queue, claimed through the inbox (ADR 0078 §3). */
const work = (event: string): SubscriptionDeclaration => ({
  event,
  mode: 'work',
  maxAttempts: 5,
  dedupe: 'inbox',
});

/**
 * The organization's own books, kept from the facts the fleet already
 * announces ([ADR 0078](../../../../docs/adr/0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md)).
 *
 * **Planned, and declared now for one reason.** ADR 0068 publishes an event
 * only when a slice subscribes to it, and a module hears from its activation
 * on — nothing is replayed (ADR 0078 §4). Without a declared subscriber
 * `stock-movement.recorded` could not be published, and every movement written
 * until the module arrived would be a fact nobody could recover. Declaring the
 * subscriptions here is what makes the producers state them today.
 *
 * It claims **no domain** yet: its ODA/SID name is ADR 0078's open question 7,
 * and a domain name is a package identity, a permission namespace and an
 * entitlement key at once (ADR 0005), so it is chosen with the package rather
 * than ahead of it. The store is the organization's ledger — tenant plane, one
 * database per organization like the other books a vendor keeps — and hosts no
 * entity until the domain lands.
 *
 * It subscribes to the four announcements a sale and its money make and to the
 * stock ledger. Cost control, services and manufacturing are declared when
 * their own subscriptions differ from these; until then this slice is the
 * listener ADR 0078's Resolved §2 counts.
 */
export const accountingSlice: SliceDeclaration = {
  name: 'accounting',
  status: 'planned',
  domains: [],
  stores: [
    {
      name: 'accounting',
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
  subscriptions: [
    work('order.placed'),
    work('order.cancelled'),
    work('payment.captured'),
    work('payment.refunded'),
    work('stock-movement.recorded'),
  ],
};
