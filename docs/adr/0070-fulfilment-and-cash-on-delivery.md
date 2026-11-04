# 70. Fulfilment and cash on delivery, and one composed checkout per channel

- Status: Accepted
- Date: 2026-10-28
- Revised: 2026-11-04 — the delivery flow built (#488): a vendor's `dispatch` starts it, it branches on the courier's report through guards on its waits, a refused card delivery refunds as a retried step after the dispatch pivot rather than through a child flow, a return the window never sees strands the flow, and a parcel is returned only after it was refused
- Revised: 2026-11-04 — the dispatch worklist (#489): a vendor's `dispatch` settles when the flow parks on the courier's report, through `flow.waiting`, rather than when the flow ends
- Area: business
- Read when: an order ships, is delivered, refused or returned, a buyer pays the courier, or the till sells — fulfilment is its own slice, every slip has one commit point, and the counter and the storefront are one composed checkout

## Context

Fulfilment is "not yet" in [BUSINESS-ARCHITECTURE.md](../BUSINESS-ARCHITECTURE.md):
nothing records that an order left a vendor, arrived, or came back. Roughly a
fifth of Guatemalan e-commerce is _contra entrega_, where money reaches a
courier's hand days after the order, and a 900-second stock hold
([ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)) cannot survive
until then. The till and the storefront answer their checkout synchronously
([ADR 0056](0056-the-counter-sale-is-the-checkout-saga.md)).

## Decision

### A domain, a slice and a store

Domain `shipping-order-management` (TMF700), slice `fulfilment`, store
`fulfilment` — tenant plane, `fulfilment_<organizationId>` — on index 10
(`3110`, inspector `9110`). The slice is declared `planned` until its store is
written.

### Every slip has one commit point

A card checkout's commit point is the capture; a cash-on-delivery checkout's is
`flow.commit@1`. Stock conversions run after it in both, so a hold never has to
outlive its expiry waiting for a courier.

### The delivery flow

Dispatch is its pivot, and a vendor's `dispatch` verb starts the flow rather
than moving the shipment itself. After it the flow waits for the courier's
report, then records the collection and closes; or — refused, or no report in
the delivery window — waits for a return, restores the stock and closes. Which
tail runs is decided by the report: each step after the wait is guarded on the
outcomes it was answered with.

The vendor's `dispatch` settles when the flow parks on the courier's report,
not when the flow ends: parking past the pivot announces `flow.waiting`
([ADR 0073](0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md)),
so the screen shows the shipment dispatched and the report's verbs free while
the flow still waits days for them.

A refused card delivery refunds as a **retried step after the dispatch**, not
through a child flow. A slip has one point of no return and this one already
passed it, so everything after it rolls forward
([ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)) —
which is exactly a refund that has to happen: retried, idempotent on its key,
and refused by the allocation's guard past what was captured. A child flow
would have been a second recipe, a second start route and a step calling the
coordinator itself, all for the same call.

A return that the return window never sees **strands** the flow for a person:
nothing in it can decide whether goods that are nowhere go back on the shelf.
A parcel is returned only after it was refused — one delivered is the flow's
end, and a return after delivery is a flow of its own, not built. Card orders
ship too, so the old `fulfil` verb is deleted.

### Catalog extensions

`order.open-group`, `order.mark-dispatched`, and `fulfilment.open`, `.hold`,
`.release`, `.withdraw`. Dispatch and cancel are serialized by one conditional
write on the shipping order. Waits are completed by transaction-service
consuming `shipping-order.*`, and every crossing is named one by one.

### Business dials, seeded

| Dial                       | Default                         |
| -------------------------- | ------------------------------- |
| COD limit per vendor order | GTQ 1,500                       |
| delivery window            | 14 days                         |
| return window              | 30 days                         |
| courier                    | manual (v1)                     |
| who holds COD cash         | the vendor                      |
| payment method             | chosen by the buyer, per seller |
| COD cancellable            | until dispatch                  |

### One composed checkout per channel

The counter and the storefront are resolutions of one composed checkout. Both
answer `202 { flowId, links }` with a flow capability; the storefront redirects
to an order-status page and settles its cookies on `confirmed`.

## Consequences

- **Revises in place** [ADR 0005](0005-business-domain-decomposition.md) (a new
  domain), [ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)
  (conversion after the commit point, restoration as a return),
  [ADR 0023](0023-service-to-service-tenant-crossing.md) (the fulfilment
  crossings), [ADR 0024](0024-selling-through-a-vendors-own-channel.md) and
  [ADR 0056](0056-the-counter-sale-is-the-checkout-saga.md) (one composed
  checkout per channel, answering `202`).
- Built in wave 4 (#481–#489).
