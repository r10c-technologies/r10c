import type { SliceDeclaration } from '../types.js';

/**
 * The saga tracker and the multi-step coordinator: it folds transaction events
 * into the durable record clients poll after their `202`, and it walks
 * declarative flow definitions.
 *
 * It owns a store, so it is a slice. Whether it runs as its own process or is
 * co-deployed into another is a deployment fact, not an ownership one — the
 * `saga` store has exactly one writing slice either way, and moving it is a
 * matter of pointing `deployments` at a different app.
 *
 * **That claim was cashed on 2026-09-08 (#229).** ADR 0039 deferred the split to
 * `:3103` with a stated condition — *"the first flow with a participant outside
 * marketplace-admin-service"* — and checkout's participants are stock-service
 * and order-service. The trigger fired, and the split was what ADR 0021 said it
 * would be: this declaration's `deployments` moved, `saga/store.ts` moved with
 * its explicit `client.db(name)` handle, and no data moved at all.
 *
 * It still hosts **no domain**. Orchestration is a mechanism, and a domain name
 * is simultaneously a package identity, the `@entity({ domain })` value, a
 * permission namespace and an entitlement key — none of which anything would
 * ever be provisioned for here.
 */
export const transactionSlice: SliceDeclaration = {
  name: 'transaction',
  status: 'active',
  domains: [],
  stores: [
    {
      name: 'saga',
      plane: 'control',
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['transaction-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET /api/transaction/:id',
    'GET /api/transaction/events',
    // Where a flow stopped and what has been reversed — the read ADR 0039
    // chose orchestration for, served once the coordinator became resumable
    // (#233). Scoped to the organizations the flow's own calls named, because a
    // flow spanning two vendors belongs to both.
    'GET /api/saga/:id',
    // The coordinator. Generic rather than `/api/checkout`, because this slice
    // declares no domain and a business verb here would put a domain name in a
    // permission namespace (ADR 0039, ADR 0052).
    'POST /api/saga/:definition',
  ],
  dependantAPIs: [
    'GET /api/config/:service',
    // The steps checkout dispatches, each behind ADR 0023's crossing with that
    // participant's own token. Named here because a split needs to know them.
    'POST /api/reservation',
    'DELETE /api/reservation/:id',
    'POST /api/product-order',
    'DELETE /api/product-order/:id',
  ],
  publishedEvents: [],
  subscriptions: [
    // Work: the fold is an idempotent upsert that wants exactly one replica,
    // and it must not lose an event across its own restart.
    //
    // `inbox` although the upsert *is* naturally idempotent: the claim and the
    // fold commit in one Mongo transaction, so the mechanism has a live
    // exerciser before the first consumer that genuinely cannot be natural — a
    // stock decrement, a payment capture — depends on it being correct.
    { event: 'transaction.*', mode: 'work', maxAttempts: 5, dedupe: 'inbox' },
    // Broadcast, and the first in the register: this one feeds the browser
    // connections held by `GET /api/transaction/events`. Every replica holds
    // *different* connections, so a `work` queue would deliver each event to one
    // replica and the clients on the others would silently never learn
    // (ADR 0030 built the mode for this consumer; ADR 0036 is the consumer).
    //
    // `natural`, and it could not be otherwise: a broadcast queue is anonymous
    // and dies with its connection, so there is no durable consumer identity to
    // key a claim on. The handler pushes into a bounded in-memory hub and the
    // browsers behind it re-read the record, so a repeat costs a duplicate hint
    // and nothing else.
    {
      event: 'transaction.*',
      mode: 'broadcast',
      maxAttempts: 5,
      dedupe: 'natural',
      dedupeReason:
        'Publishes into an in-memory pub/sub hub; a repeated delivery is a ' +
        'duplicate hint and the browsers behind it re-read the record.',
    },
  ],
};
