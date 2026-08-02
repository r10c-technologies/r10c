# 10. Stock as a movement ledger; purchases reserve rather than decrement

- Status: Proposed
- Date: 2026-08-01

## Trigger

The first `StockItem` entity, or the first checkout route. Whichever comes first
promotes this record to Accepted.

## Context

The scenario that tests the whole architecture: a buyer purchases while the
vendor receives new stock, both touching the same product's availability.

It is tempting to read this as a distributed-transaction problem — order lives in
the platform plane, stock in the tenant plane, therefore two databases, therefore
two-phase commit. It is not. Two distinct concerns are usually conflated here,
and separating them dissolves the problem.

## Decision

### Availability is not a field on a product

A product definition is owned by `product-configuration-management`; stock is a
fact owned by `stock-management`. A quantity on the product record would make two
domains write one document — the coupling the decomposition exists to prevent
([ADR 0008](0008-domain-modules-and-service-topology.md)).

`StockItem { productId, onHand, reserved }`, and nothing outside stock-management
writes it.

### A quantity is never read-modify-written

Read `onHand=10`, write `9`, while another writer reads `10` and writes `60`: one
overwrites the other. Note this happens **inside a single process handling two
requests** — service count is irrelevant, so no amount of service topology fixes
it.

Quantities move by atomic in-place operators only:

```
// Mongo                        // Postgres
{ $inc: { onHand: 50 } }        UPDATE stock_item SET on_hand = on_hand + $1 …
```

over an append-only **`StockMovement`** ledger (`+50` receipt, `−1` sale, `+1`
cancellation) with the running total materialized on `StockItem`. Audit and
reconciliation come free, and a future logistics integration is one more movement
type rather than a new module.

### A purchase reserves; the conditional write _is_ the concurrency control

Checkout takes one conditional atomic write:

```js
findOneAndUpdate({ productId, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, qty] } }, { $inc: { reserved: qty } });
```

Zero documents matched means out of stock, and the buyer is told immediately.
There is no read-then-check window to lose.

Then: the reservation carries a TTL; payment confirmed converts it to a `−qty`
sale movement; payment failed or TTL expired releases it. A reaper sweeps
reservations whose holder died mid-flight.

So the vendor's `$inc onHand +50` and the buyer's guarded `$inc reserved +1`
touch different fields, are both atomic, and are order-independent. There is no
race to resolve.

### Do not take a distributed lock per decrement

`LockService` (`entifix-transactions/ports/lock-service.ts`) is for **coarse**
operations: a catalog publication, a settlement run, an order spanning several
vendors.

A Redis `SET NX PX` per product serializes every purchase of a popular item
through one key. Throughput becomes one lock round-trip, and contention surfaces
to real buyers as `409`. The conditional update has no such ceiling. This is the
tempting mistake, so it is written down as a prohibition.

### The saga carries the cross-plane part only

`order-management` (platform) calls `stock-management` (tenant) **synchronously**
to reserve — the buyer needs a yes/no now — and the order holds a **reservation
id**, never a quantity. If the order write then fails, the compensation releases
the reservation, which is exactly `rollbackUCFactory` in the existing engine.

A multi-vendor cart is N reservations across N tenants, with N−1 compensations if
one fails. That is a marketplace's normal case, and it is what the saga is for.

### This is forced by payment latency, not by topology

A database transaction cannot be held open across an external payment that takes
seconds to minutes. The reservation model would be required even with orders and
stock in the same database. Worth stating, because it means the plane split costs
nothing here — a natural place to wrongly conclude the architecture is to blame.

## Consequences

- **`onHand` is derived and must be reconcilable.** The ledger is the truth; the
  materialized total is a cache. A reconciliation job that replays movements and
  compares is not optional.
- **Reservations need a reaper**, and a crashed service leaves stock held until
  the TTL expires. TTL length is a direct trade between overselling risk and
  temporary under-availability.
- **The storefront may show stock that is gone.** Correct and intended: display
  is a hint, the reservation is the truth
  ([ADR 0009](0009-catalog-authoring-and-publication.md)).
- **Overselling is possible only outside the reservation path** — a manual
  adjustment, or a bug writing an absolute value. The rule against
  read-modify-write is what keeps that surface at zero.
- **Stock reads on the storefront are projections**, never live tenant queries.

## Follow-ups (deliberately out of scope)

- Backorders, pre-orders, and negative-stock policies.
- Multi-location stock and allocation strategy.
- Reservation extension during a slow payment.
