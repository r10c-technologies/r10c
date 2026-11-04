import type { SliceDeclaration } from '../types.js';

/**
 * The multi-step coordinator: it walks declarative flow definitions. The
 * tracker that folded single-step transaction events beside it left with its
 * only producer, the specification create (#463).
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
    // The durable flow engine's (ADR 0066): every flow's journal, the runners'
    // registrations and shard locks, each flow's status, and the outbox its
    // announcements leave through — one Postgres database, written by this
    // slice's runners alone. It runs beside `saga` until the saga runner is
    // deleted (#490).
    {
      name: 'workflow',
      plane: 'control',
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['transaction-service'],
  coDeployedWith: [],
  exposedAPIs: [
    // Where a flow stopped and what has been reversed — the read ADR 0039
    // chose orchestration for, served once the coordinator became resumable
    // (#233). Scoped to the organizations the flow's own calls named, because a
    // flow spanning two vendors belongs to both.
    'GET /api/saga/:id',
    // The coordinator: one start per registered flow, each behind its own
    // crossing permission. Under `/api/saga/` rather than `/api/checkout`,
    // because this slice declares no domain and a business verb here would put
    // a domain name in a permission namespace (ADR 0039, ADR 0052).
    'POST /api/saga/checkout',
    'POST /api/saga/cancellation',
    // The flow engine's starts, one per recipe, each answered `202` with the
    // flow to follow (ADR 0066). The saga starts above go with #490.
    'POST /api/flow/checkout',
    'POST /api/flow/cancellation',
  ],
  dependantAPIs: [
    'GET /api/config/:service',
    // What each vendor a flow acts for is provisioned for, read from the
    // published vendor projection rather than taken from the caller.
    'GET /api/published-vendor',
    // Every call a flow's fragments make, each behind ADR 0023's crossing with
    // that participant's own token. Checked against the fragment catalog's
    // snapshot, so a flow cannot dispatch to a route this list omits (ADR 0065).
    'POST /api/reservation',
    'DELETE /api/reservation/:id',
    'POST /api/reservation/:id/conversion',
    'POST /api/stock-restoration',
    'POST /api/checkout-group',
    'DELETE /api/checkout-group/:id',
    'POST /api/product-order',
    'DELETE /api/product-order/:id',
    'POST|DELETE /api/product-order/:id/cancelling',
    'POST /api/product-order/:id/confirmed',
    'POST /api/product-order/:id/dispatched',
    'POST /api/product-order/:id/closed',
    'POST /api/payment',
    'POST /api/refund',
    'POST /api/collection',
    'POST /api/cod-eligibility',
    // The delivery flow's shipment steps (ADR 0070). The two waits name the
    // shipment's read as their call: a wait makes none, and is completed by
    // the `shipping-order.*` event it waits on.
    'POST /api/shipping-order',
    'POST|DELETE /api/shipping-order/:id/hold',
    'POST /api/shipping-order/:id/withdrawal',
    'POST /api/shipping-order/:id/dispatch-step',
    'GET /api/shipping-order/:id',
  ],
  // What the durable engine announces through the `workflow` store's outbox
  // (ADR 0066): a flow's outcome, which the realtime slice pushes to the flow's
  // audience, and every step of it into the flow-status projection.
  publishedEvents: [
    'flow.started',
    'flow.suspended',
    'flow.completed',
    'flow.failed',
  ],
  subscriptions: [],
};
