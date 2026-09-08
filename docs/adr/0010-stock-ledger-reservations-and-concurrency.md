# 10. Stock as a movement ledger; purchases reserve rather than decrement

- Status: Accepted
- Date: 2026-08-01
- Area: business
- Read when: touching stock quantities — a quantity is never read-modify-written, and a purchase reserves rather than decrements
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  trigger fired; the store is named, and the cross-plane call has a mechanism.
- Revised: 2026-09-08 — the ledger half is built (#150): stock-service on
  `:3108` records movements and folds them with `$inc`, so the slice is `active`;
  the member is `offeringId` rather than the `productId` this record wrote, and
  the reservation half is still unbuilt.

## Trigger

~~The first `StockItem` entity, or the first checkout route.~~ **Fired** on
2026-08-12: ADR 0022 landed `StockItem`, `StockMovement` and `Reservation`, so
this record is Accepted.

The _decisions_ are in effect — the ledger shape, the two separate counters, the
conditional atomic write.

**Built on 2026-09-08 (#150):** stock-service owns the store and serves the
ledger. A movement is a signed quantity plus a reason, the two are checked
against each other (`isConsistentMovement`), and the row and the `$inc` commit in
one Mongo transaction — separately written, a crash between them leaves a total
no movement explains, which is exactly what makes a fold unreconcilable. There is
deliberately **no route that writes a `StockItem`**, and no `PUT` or `DELETE` on a
movement.

⚠️ **The fold needs a unique index, which this record did not say.** `$inc`
removes the lost update; it does not make the total _singular_. `updateOne` with
`upsert: true` is atomic per document, so concurrent movements for one offering
each fail to see the other's uncommitted insert and each create a row: measured
on the live lab, 20 simultaneous receipts produced **nine** `StockItem`
documents while the ledger stayed perfectly correct at 20 rows summing to 20.
Nothing was lost and nothing was read-modify-written — what broke was the
_identity_ of the fold, and `availability()` then reads one row of nine.

So `stock-item` carries a unique index on `offeringId`, ensured per tenant
handle because a tenant database appears on first write, **and** the upsert is
retried once on a duplicate key: the loser of the race then finds the winner's
document and takes the update branch. The index alone would turn a silently
split total into a `500` on a request the vendor did nothing wrong in, which is
a different bug rather than a fix.

**Still unbuilt:** the reservation, its reaper, and the checkout that exercises
them. The conditional atomic write below is therefore a decision in force and not
yet a line of code.

Two things this record could not name when it was written, now settled:

- **The store is `stock`**, tenant plane, per-organization — physically
  `stock_<organizationId>`, a **separate database** from the catalog's
  `tenant_<organizationId>`. Same plane, same partitioning, different store, so
  one-writer-per-store is a property of which handle a request resolves to rather
  than of review. The two must never transact together anyway; a cross-domain
  write goes through the saga.
- **The cross-plane reserve call has a mechanism.** order-management is platform
  plane and a buyer's session carries no organization — the vendor comes from the
  item. That crossing is
  [ADR 0023](0023-service-to-service-tenant-crossing.md): an explicit
  `organizationId` authorized by a service token plus
  `stock-management:reservation:write`, never by the absence of a check.

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

`StockItem { offeringId, onHand, reserved }`, and nothing outside
stock-management writes it.

> The member is `offeringId`. This record wrote `productId`, which named nothing
> in the model that landed: stock is held against the vendor's own
> `ProductOffering`, and it is a plain id rather than a `link` because the target
> lives in another store and a link would invite the storage-layer join the
> one-writer rule forbids.

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
findOneAndUpdate({ offeringId, $expr: { $gte: [{ $subtract: ['$onHand', '$reserved'] }, qty] } }, { $inc: { reserved: qty } });
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
