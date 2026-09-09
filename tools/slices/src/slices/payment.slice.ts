import type { SliceDeclaration } from '../types.js';

/**
 * Taking money for an order.
 *
 * Payment service provider integration is out of v1 scope, but the slice is not
 * deferred with it: without a payment there is no event that converts a stock
 * reservation to a sale, and settlement has no input at all. v1 is the `Payment`
 * record behind a `PaymentProviderTag` port with a simulated adapter, so the
 * order state machine and the commission ledger are real and testable.
 *
 * Its own store rather than a corner of `order`, so "which slice writes a
 * payment?" has one answer and a PSP-facing process — webhooks, retries,
 * reconciliation, all of which arrive on someone else's schedule — can be lifted
 * out without touching orders.
 *
 * **Promoted to `active` by the commit that wrote the store** (#152):
 * payment-service on `:3106`.
 *
 * ⚠️ **`POST /api/payment` is the checkout saga's pivot**, which makes this the
 * one slice in the fleet with a write that cannot be compensated. Its crossing
 * permission is therefore unpaired — every other entry in
 * `SERVICE_CROSSING_PERMISSIONS` has a reversal beside it and this one has none,
 * deliberately ([ADR 0054](../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 */
export const paymentSlice: SliceDeclaration = {
  name: 'payment',
  status: 'active',
  domains: ['payment-management'],
  stores: [
    {
      name: 'payment',
      plane: 'platform',
      hosts: ['payment-management'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['payment-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET|POST /api/payment',
    'GET /api/payment/:id',
    'GET /api/payment/$metadata',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: ['payment.captured', 'payment.failed'],
  // ⚠️ **Nothing. It subscribed to `order.placed` and no longer does.**
  //
  // That declaration described an event-driven capture: the order lands, a
  // message arrives, the money is taken. ADR 0052 had already decided
  // otherwise — capture is a saga step, and M4 is where the pivot lands — and
  // the two could not both be built. ADR 0054 settles it in favour of the saga,
  // because a buyer waiting at a checkout needs a yes or no now and a hold on a
  // vendor's stock expires in minutes.
  //
  // The idempotency the old declaration asked for did not go away with it: it
  // moved to where the dispatch actually arrives, as a command-id claim in the
  // same transaction as the write. `dedupe: 'inbox'` guards a *message*; this
  // route is not reached by one.
  subscriptions: [],
};
