# 69. A checkout group of per-vendor orders, and a capture allocated per order

- Status: Accepted
- Date: 2026-10-28
- Revised: 2026-11-13 — the storefront's checkout starts from a review step that shows each seller's lines, tender and the total; the cart no longer starts it (#534)
- Area: business
- Read when: a basket spans vendors, a vendor acts on their part of a sale, or a refund is partial — a checkout writes one group and one order per vendor, and one capture is allocated per order

## Context

[ADR 0022](0022-v1-marketplace-module-boundaries.md) §5 made one `ProductOrder`
carry vendor-tagged lines, so a buyer gets one receipt across vendors. Its
accepted cost has arrived:

- a vendor's reads query a dotted path into the lines
  ([ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md));
- a vendor cannot cancel their part of a shared basket, answering
  `409 multiVendorOrder` ([ADR 0058](0058-the-order-after-payment.md));
- one capture allows one refund, so a partial refund cannot be said at all;
- settlement joins a payment to an order and then splits by vendor
  ([ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md)).

## Decision

### A group, and one order per vendor

A checkout writes one `CheckoutGroup` — the buyer's receipt, holding the
cancellation digest — and one `ProductOrder` per vendor carrying top-level
`vendorId`, `groupId` and `paymentMethod`. Statuses gain `confirmed` and
`dispatched`. Cancel, fulfil and refund act on one vendor's order, and
`multiVendorOrder` is deleted.

The storefront writes none of it from the cart (#534). The cart's form is a
plain `GET` to a review step, carrying the tender chosen per seller on the
query string; the review shows each seller's lines, how they are paid and the
total, and only Place order there posts the checkout — with the totals it
showed. The checkout re-prices from the published catalog rather than trusting
the page, and when that no longer matches what was reviewed — a price moved, a
line stopped being sold — it starts nothing and sends the buyer back to the
review, which says so. Both steps are plain forms, which is what a buyer
without script relies on.

### One capture, allocated per order

A card checkout takes one capture for the group and records a
`PaymentAllocation` per order (authorized, captured, refunded). A partial refund
is a conditional `$inc` on one allocation, never beyond what it captured.
`payment.captured` carries `allocations[]`, settlement joins per order, and a
cash-on-delivery order takes no capture at all
([ADR 0070](0070-fulfilment-and-cash-on-delivery.md)).

## Consequences

- A vendor's order is theirs alone: reads narrow on a top-level `vendorId`, and
  a vendor can cancel or refund their part of a basket.
- **Revises in place** [ADR 0022](0022-v1-marketplace-module-boundaries.md) (one
  order per vendor under a group), [ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md)
  (the receipt is the group, and a flow capability is a third nonce credential),
  [ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md) (the join key is
  the allocation) and [ADR 0058](0058-the-order-after-payment.md) (cancel and
  refund are per vendor order).
- Built in wave 4 (#479, #480, #484).
