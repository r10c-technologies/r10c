# 70. Fulfilment and cash on delivery, and one composed checkout per channel

- Status: Accepted
- Date: 2026-10-28
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

Dispatch is its pivot. After it the flow waits for delivery, then records the
collection and closes; or waits for a return, restores the stock and closes. A
refused card delivery refunds through a child flow. Card orders ship too, so
the old `fulfil` verb is deleted.

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
