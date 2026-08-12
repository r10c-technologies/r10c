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
 */
export const paymentSlice: SliceDeclaration = {
  name: 'payment',
  status: 'planned',
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
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: ['GET|POST /api/payment', 'GET /api/payment/:id'],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: ['payment.captured', 'payment.failed'],
  subscribedEvents: ['order.placed'],
};
