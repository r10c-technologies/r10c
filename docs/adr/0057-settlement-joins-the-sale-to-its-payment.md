# 57. Settlement joins the sale to its payment, and the ledger states its own base

- Status: Accepted
- Date: 2026-09-10
- Area: business
- Read when: pricing a vendor's commission, or a consumer needs data that no single event on the bus carries — the fold joins two messages on the order id, and a payout is the gross less the cut rather than the sum of the cuts
- Revised: 2026-09-11 by [ADR 0058](0058-the-order-after-payment.md) — the unique index backstopping the fold gains `kind` as a third key

## Context

[ADR 0022](0022-v1-marketplace-module-boundaries.md) §8 decided the shape of
settlement and built none of it: commission is **captured per sale** as a
`CommissionEntry` rather than computed at payout time, so a rate change cannot
silently rewrite history. [ADR 0024](0024-selling-through-a-vendors-own-channel.md)
§4 then made the rate per channel type with a default and said settlement must
resolve it through `Agreement.commissionFor`.
[ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md) §4 said
settlement would consume `payment.captured` in M6, "unchanged".

Building it surfaced the thing none of those records had to look at, because none
of them was writing the fold: **what `payment.captured` actually carries.**

```
paymentId, orderId, amount, currency, paymentMethod, decidedAt,
channelId?, providerReference?, failureReason?
```

Pricing a vendor's cut needs two things that are not in that list. It needs the
**vendor-tagged lines** — an order can span several vendors, and each owes its own
commission on its own subtotal — and they live only on `ProductOrder.items`. And
it needs the channel **type**, because `commissionFor` is keyed by type; the
payload carries a channel _id_, which is a pointer into a tenant-plane `sales`
store that a platform read path must never open.

So a consumer holding only `payment.captured` knows that money moved and cannot
say whose it was or at what rate.

Two further facts shaped the answer.

**`order.placed` carries exactly the missing half, and has no consumer.** It is
`serializeEntity(ProductOrder, order)` — the whole receipt, including `items[]`
with `vendorId`, `quantity`, `amount` and `currency`, and `channel` as the whole
`{ id, name, type }` copy denormalized onto the order for precisely the readers
who hold no tenant handle. ADR 0054 §5 recorded that it is published and drained
with nothing subscribed, and said "its consumer arrives later".

**The payload already says the two belong together.** `PaymentOutcome`'s
`correlationId` is the order id, and the comment on it reads: the order is "what
correlates this message with the `order.placed` before it and the settlement
entry after it."

## Decision

### 1. Settlement subscribes to both, and joins them on the order id

Two work queues, `settlement.order.placed` and `settlement.payment.captured`.
Each handler claims its message in the `transaction_inbox` — compound on
`(consumer, eventId)`, which is what lets two consumers share one database — and
upserts its own half into a `settlement_pending_sale` document keyed by the order
id, in **one** Mongo transaction. Whichever upsert completes the pair writes the
commission entries in that same transaction.

⚠️ **Arrival order is not assumed in either direction.** The two events come off
different outboxes, through different relays, with independent retries and
independent quarantines. A rule that the order "obviously" precedes the payment
would be true almost always and catastrophic the once it is not — a sale priced
against a join record that was never written, or a capture parked waiting for a
message that already arrived. The record is written by both handlers and read by
both, so there is no race to reason about and no timeout to tune.

⚠️ **The fold's claim is conditional, not merely guarded.** `folded: false` is in
the _filter_ of the update that sets it, so two redeliveries arriving together
cannot both see a complete pair and both write. The unique index on
`(orderId, vendorId)` is the backstop under that.

> **2026-09-11 — that index gains a third key.**
> [ADR 0058](0058-the-order-after-payment.md) reverses a commission entry with a
> second, sign-flipped row for the same pair, which this two-key index would
> refuse as a duplicate. It becomes `(orderId, vendorId, kind)`. The backstop is
> unchanged in kind — one row per pair **per kind** — and the fold's reasoning
> above is untouched.
>
> **And the join record grows two more halves rather than acquiring a sibling.**
> `settlement_pending_sale` now carries `cancelledAt`, `refundedAt` and a second
> conditional claim beside `folded`, so one document holds both pairs and both
> folds run on every pass. A reversal in a collection of its own could not see
> whether the sale had been folded, and would write nothing — permanently — for
> an order whose `order.placed` was still quarantined when the cancellation
> landed. Sharing the record is this section's own "arrival order is not assumed
> in either direction" applied between the two folds as well as within each, and
> it is what lets a late placement write the sale and its mirror together.

**Rejected: an HTTP read into order-service.** `GET /api/product-order/:id`
accepts a session and no crossing token, by the "one route, one credential, each
way" rule this fleet holds everywhere. Opening it to settlement means a new entry
in `SERVICE_CROSSING_PERMISSIONS`, a second accepted credential on a read route —
which makes the weaker one that route's security level — and a crossing secret
held by a fourth process. It also points a batch slice synchronously at a
request-path one. The bus already carries the data.

**Rejected: widening `payment.captured`.** payment-service does not hold the
lines either. It would have to make the same read first, and the coupling would
land in a slice that has no reason to know what a vendor is.

### 2. The order's half is priced on arrival, not at fold time

The join document stores the **priced** commissions rather than the raw lines. It
falls out of where the data is — only that half has the lines and the channel, so
the capture handler needs no agreement read and no arithmetic at all.

It also fixes _when_ the rate is read, which is the point ADR 0022 §8 was making.
Pricing at fold time would read whatever the agreement says at the moment the
second message happens to land, reopening the window that capturing commission
per sale exists to close.

### 3. A decoder, not an import of `ProductOrder`

settlement-service reads five fields off the `order.placed` payload through its
own decoder. It does not import `order-management`, although an app legally
could.

The usual argument against a hand-written copy is
[ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md)'s:
nothing compares two copies of a structure, so a member added on one side only is
a field the consumer silently never sees. That failure does not apply here, and
the asymmetry is why. A member **added** to `ProductOrder` is a member this
decoder ignores. A member **removed** is a payload this decoder rejects — which
classifies the message poison and quarantines it with zero retries
([ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md)), loudly. Nothing
fails quietly in either direction, so a contracts package would buy back nothing
that is currently at risk.

The alternative worth naming: make order-service publish a purpose-built payload
instead of its serialized entity. That is a change to a slice this work does not
own, and it is the right move the day a second consumer wants the same data.

### 4. A `CommissionEntry` states its base, its date and its run

Three members are added, and each one closes something that could not otherwise
be done at all.

- **`saleAmount`** — the vendor's subtotal for that order, before the cut. A line
  that records what the platform took and not what it took a share _of_ is
  unauditable in exactly the dispute that capturing commission per sale exists to
  survive.
- **`occurredAt`** — the capture's own `decidedAt`, never `now`. It is what a run
  compares against its period, so stamping the handling time would file a sale
  under whichever period the consumer was running in, and a redelivery or a
  replay would file it differently each time.
- **`runId`** — absent means unsettled. A run selects the entries in its period
  carrying no run id and stamps itself onto them in the same write, so a second
  run over the same period finds nothing left. The entry's own docblock already
  described a payout as "every entry for this vendor, unpaid" while the member
  that sentence needs did not exist.

### 5. A payout is the gross less the cut, not the sum of the cuts

Both `VendorPayout` and `CommissionEntry` described a payout as "the fold of that
vendor's commission entries". Folding commission amounts totals what the platform
**keeps**, and filing that under a record named for the vendor is a number that
means the opposite of its label.

`VendorPayout.amount` is `Σ saleAmount − Σ commissionAmount`. This is the
immediate reason `saleAmount` is captured rather than a nicety: without it the
record cannot be computed at all. Both docblocks are corrected in place.

### 6. Rounding is once per vendor, on the subtotal

`Math.round(subtotal × basisPoints / 10000)`, applied to the vendor's subtotal
rather than to each line.

Rounding per line and summing gives a different answer — two lines of 333 at 2.5%
round to 8 each, while their sum of 666 rounds to 17 — and a statement whose lines
do not add up to its total is a statement a vendor disputes. Round-to-nearest
rather than a floor, so the platform is not systematically short by up to a cent
on every sale in the ledger.

### 7. A vendor with no agreement is named, never priced

The fold writes no entry for them and logs at error level with the vendor id; the
rest of the order still settles.

There is no default commission in this system — there is a default _within_ an
agreement. Inventing one would put a commercial term nobody negotiated into a
ledger whose entire purpose is to be defensible. Refusing the whole message
instead would quarantine a sale that is mostly priceable, and the loud log is the
signal that a real vendor is selling with no terms on file.

Lines for **one** vendor in two currencies are refused outright and the message is
quarantined: 500 EUR plus 500 GBP is 1000 of nothing, and a commission taken from
that number would be charged to somebody real. Two _different_ vendors in
different currencies is ordinary and gets an entry each.

### 8. The reads are narrowed to the caller, which is why a grant exists

An operator reads across vendors. A vendor reads their own agreement, their own
ledger lines and their own payouts, through a predicate conjoined onto the load
request. Anyone else gets an empty page, and a by-id read outside the scope
answers `404` rather than `403` — a `403` confirms to a competitor that the
vendor they named has an agreement.

ADR 0054 withheld `payment-management:payment:read` from every role but `admin`
because a `Payment` carries neither buyer nor vendor to key a predicate on, and
recorded the residual rather than shipping unscoped. Every record here carries a
`vendorId`, so the predicate the payment read wanted is available — and it has to
be, because a commission rate is a negotiated term and a competitor learning it is
an injury with no undo.

**`agreement:write` is granted to no role.** An `admin` who could write it could
set their own commission to zero. It is an operator act, reached through
`super-admin`'s wildcard. Nothing writes the ledger, the runs or the payouts
either: a fold produces them and nobody authors them, so the served `$metadata`
descriptor withholds Save and no screen has to say so
([ADR 0033](0033-the-screen-taxonomy.md)).

### 9. A run claims its own record rather than taking a lock

The slice declaration used to call a settlement run "the exact coarse operation
`LockService` is for". That note predates
[ADR 0055](0055-a-coordinator-resumes-from-its-own-record.md), which chose a
conditional write over a distributed lock for the saga resume sweep, and the
argument transfers unchanged: the `SettlementRun` being walked is already the
durable record of intent, so claiming it with a conditional write needs no second
datastore. settlement-service opens no Redis connection. The declaration comment
is corrected in place.

## Consequences

- **The commission ledger fills.** A storefront checkout and a counter sale both
  produce entries, and the counter one prices at the agreement's `counter: 0`
  rate while the storefront one takes the default — which is the first time the
  per-channel rate ADR 0024 put on the `Agreement` has been read by anything.

  > **2026-09-11 — it did not, until the commit that built ADR 0058 §9 drove the
  > first live sale through it.** Three defects, each of which alone kept the
  > ledger empty, and none of which any build or test caught: the two bus
  > handlers were written with `Effect.fn`, whose value this runtime cannot
  > execute, so the process died on the first delivered message; the fold's
  > `[...new Set(ids)]` produced iterator objects rather than vendor ids in the
  > bundle, so the agreement query matched nothing and every vendor was reported
  > as having no terms on file; and the sweep's `[...byVendor]` failed the same
  > way, so every settlement run ended in `Failed to settle`. The decision in
  > this record is untouched — the mechanism was right and unreachable. What it
  > shows is that a slice whose only inputs arrive on a bus has **no automated
  > coverage at all** here: the mock e2e profile boots no broker, so no handler
  > runs in it, and a consumer that dies on its first message keeps every
  > readiness probe green while its queues fill.
- **`order.placed` has a consumer**, which ADR 0054 §5 said would arrive later.
  Its relay stops being a backlog drained for its own sake.
- **The last of ADR 0022's four planned slices is promoted**, and the reserved
  index list is empty.
- **This slice holds no crossing token and accepts none** — the only one in the
  fleet with a store, a bus connection and no service secret at all. Both inputs
  arrive on the bus, so there is nothing to authenticate inbound.
- **A settlement run is not a payment.** It calculates what is owed and publishes
  `settlement.run.completed`; moving the money is a payouts process that does not
  exist, and nothing consumes that event yet.
- **Residual: the join document is never swept.** A sale whose payment never
  captures — a checkout that compensated, say — leaves a half-written record in
  `settlement_pending_sale` forever. Since 2026-09-11 the same is true of an
  order cancelled before it was paid, which contributes a `cancelledAt` to a
  reversal pair no refund will ever complete. It is small, it is inert, and it is honest
  about what happened; a sweep that expired them would need a rule for how long a
  capture may legitimately take, which nothing knows yet.
- **Residual: nothing charts the ledger.** The outbox relay and the bus export
  their own metrics and those are enough to see the fold moving. A gauge of
  unsettled entries is worth having once there is something to compare it
  against.
