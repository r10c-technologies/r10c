import type { SliceDeclaration } from '../types.js';

/**
 * The flow coordinator: it composes a slip from what it verified and hands it
 * to the durable flow engine, whose runners walk it (ADR 0066). The saga
 * runner, its `saga` store and its instance read were deleted when checkout
 * and cancellation moved onto the engine (#490).
 *
 * It owns a store, so it is a slice. Whether it runs as its own process or is
 * co-deployed into another is a deployment fact, not an ownership one — the
 * `workflow` store has exactly one writing slice either way, and moving it is
 * a matter of pointing `deployments` at a different app. That claim was cashed
 * once already, on 2026-09-08 (#229), when the coordinator split out of
 * marketplace-admin-service and no data moved at all.
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
    // The durable flow engine's (ADR 0066): every flow's journal, the runners'
    // registrations and shard locks, each flow's status, and the outbox its
    // announcements leave through — one Postgres database, written by this
    // slice's runners alone.
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
    // One start per recipe, each behind its own crossing permission and
    // answered `202` with the flow to follow (ADR 0066). Under `/api/flow/`
    // rather than a business verb, because this slice declares no domain and a
    // verb here would put a domain name in a permission namespace (ADR 0039).
    'POST /api/flow/checkout',
    'POST /api/flow/cancellation',
    // Started by fulfilment-service when a vendor dispatches (ADR 0070).
    'POST /api/flow/delivery',
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
    // A delivery whose parcel never came back, ended for a person.
    'flow.stranded',
  ],
  subscriptions: [
    // What a courier reported, recorded by the vendor: each answers the
    // delivery flow's wait on that shipment (ADR 0070). `dispatched` arrives
    // on the same binding and is let go.
    {
      event: 'shipping-order.*',
      mode: 'work',
      maxAttempts: 5,
      dedupe: 'natural',
      dedupeReason:
        'a signal claims the parked wait with one conditional write, so a redelivered report finds it claimed and is let go — the engine is the inbox',
    },
  ],
};
