import type { SliceDeclaration } from '../types.js';

/**
 * Order capture: one checkout becomes one `ProductOrder`, whatever the basket
 * spans.
 *
 * The multi-vendor case rides on vendor-tagged embedded lines rather than on
 * splitting the order, so the buyer gets one receipt and settlement still
 * aggregates per vendor. The accepted cost is that "orders for vendor X" is a
 * query into an array rather than a top-level filter.
 *
 * The **cart is not a store**. It is a cookie, so the storefront's first
 * response is correct without a round trip — and so the fleet keeps zero
 * anonymous write surfaces.
 *
 * This slice is the reason ADR 0023 exists: it is platform plane, it must
 * reserve stock in a tenant store, and the buyer's session carries no
 * organization.
 *
 * **Promoted to `active` by the commit that wrote the store** (#151):
 * order-service on `:3105`.
 *
 * ⚠️ **It reserves nothing itself, and `dependantAPIs` is now empty of stock.**
 * The reserve-then-write flow is a saga, and the coordinator dispatches both
 * halves — so this slice is a *participant* rather than a caller
 * ([ADR 0052](../../../docs/adr/0052-the-checkout-saga.md)). Its writes accept a
 * crossing token and no session, because the buyer behind a checkout holds no
 * grant over the receipt written on their behalf; its reads accept a session and
 * no token. One route, one credential, each way.
 *
 * ⚠️ **It is now also a *caller*, and of a flow it participates in.** The
 * cancellation saga's first and last steps are writes to this store, and the
 * flow is started from here — because a cancellation's authority is a buyer's
 * signed capability or a vendor's session, and neither is verifiable anywhere
 * but where the order lives. The cycle is accepted deliberately: letting the
 * coordinator check it would put an order's authorization rule in a slice that
 * declares no domain ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md) §6).
 *
 * So there are **three** credentials on this surface rather than two. A vendor
 * or operator cancels with a session and a verb permission; a buyer cancels with
 * the nonce from their receipt and no session at all; the saga's own steps take
 * a crossing token. Each route still accepts exactly one.
 */
export const orderSlice: SliceDeclaration = {
  name: 'order',
  status: 'active',
  domains: ['order-management'],
  stores: [
    {
      name: 'order',
      plane: 'platform',
      hosts: ['order-management'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['order-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET|POST /api/product-order',
    'GET|DELETE /api/product-order/:id',
    'GET /api/product-order/$metadata',
    'POST /api/product-order/:id/fulfil',
    'POST /api/product-order/:id/cancellation',
    'POST /api/product-order/:id/buyer-cancellation',
    'POST|DELETE /api/product-order/:id/cancelling',
    'POST /api/product-order/:id/cancelled',
  ],
  dependantAPIs: [
    'GET /api/config/:service',
    // ⚠️ **This slice starts a flow it is also a participant in.** A
    // cancellation's authority is a buyer's signed capability or a vendor's
    // session, and neither is verifiable anywhere but where the order lives —
    // so the check happens here and the coordinator is called from here, making
    // order-service the third holder of that inbound secret beside the
    // storefront and sales-service
    // ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md) §6).
    'POST /api/saga/:definition',
  ],
  publishedEvents: ['order.placed', 'order.cancelled'],
  subscriptions: [
    // `inbox`: advancing an order's state on a capture is not a rewrite of the
    // same value, so a redelivery must be recognised rather than survived.
    //
    // ⚠️ **`payment.failed` is deliberately not here any more.** A capture that
    // refuses is the checkout saga's pivot refusing, which compensates the flow
    // synchronously — and the compensation *deletes* the order. A consumer
    // setting `status = 'cancelled'` on that same order would be racing its own
    // deletion, and whichever won would be arbitrary
    // ([ADR 0054](../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
    {
      event: 'payment.captured',
      mode: 'work',
      maxAttempts: 5,
      dedupe: 'inbox',
    },
  ],
};
