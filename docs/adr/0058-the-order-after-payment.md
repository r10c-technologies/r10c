# 58. The order after payment: fulfil, cancel, refund, and a capability the coordinator never sees

- Status: Accepted
- Date: 2026-09-11
- Area: business
- Read when: a paid order has to move again, or an anonymous buyer has to be authorized for a write — the cancel is a saga whose pivot is a refund, and the buyer's capability is a digest at rest because the order write is itself a saga step

## Context

An order stops moving the moment it is paid. `OrderStatuses` has declared
`fulfilled` and `cancelled` since the domain was written and **nothing in the
fleet can reach either**. `order.slice.ts` declares `order.cancelled` among its
published events and nothing emits it.
[ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md) names a
refund four times as the thing it did not build, and records
`payment-management:payment:write` as the one unpaired entry in
`SERVICE_CROSSING_PERMISSIONS` because of it.
[ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md) folds a sale into a
`CommissionEntry` and has no way to reverse one.

The only write on an order a person could reach is
`DELETE /api/product-order/:id`, and its own route file says what it is not:

> A buyer cancelling their own order is a status transition with its own money
> consequences, and it is not this.

So this record settles the whole of an order's life after the capture. The build
is split across M7's issues; what must not be split is the reasoning, because
four of the seven pieces are in four different services and each one alone looks
arbitrary.

Two facts about the fleet shaped the answer, and neither is about orders.

**A buyer is anonymous and holds no session.** ADR 0053 established that the
storefront shows a receipt by _carrying_ it in an `httpOnly` cookie rather than
reading it back, precisely because there is no principal to scope a read to.
Cancelling is a write, and a write needs an authority that a cookie the browser's
owner can edit does not supply.

**An order is written inside the checkout saga.** That makes the order route's
`201` a _step outcome_, and ADR 0055 recorded what a step outcome is: "a
command's response **is** the step's outcome". `GET /api/saga/:id` serves the
whole instance to any principal whose organization appears among the flow's
calls — every vendor in the basket.

## Decision

### 1. Fulfilment is per line, and cancellation is per order

[ADR 0022](0022-v1-marketplace-module-boundaries.md) §5 puts one order over
vendor-tagged lines. An order-level `fulfilled` flipped by one vendor states
something about another vendor's lines that is not true, so `OrderItem` gains
`fulfilledAt` and the order reaches `fulfilled` when every line carries one.

Cancellation does not divide the same way, and the asymmetry is deliberate rather
than an oversight: fulfilment is a promise each vendor keeps separately, while a
cancellation moves money that was taken once, for the whole basket, on one
capture. Partial cancellation of a multi-vendor order is therefore out of scope
and is a decision rather than a gap.

### 2. `paid` is the only cancellable state

`pending` is a checkout still in flight or a saga that stranded, and undoing one
is the coordinator's job — a second actor cancelling underneath it would race a
compensation already on its way. `fulfilled` is a return: goods coming back,
which is logistics and belongs to the capability
`BUSINESS-ARCHITECTURE.md` already names, not to this status machine.

The docblock on `order-status.ts` said `cancelled` was reachable from `pending`
**and** `paid`. That was never true of anything built, and it is corrected.

### 3. `cancelling` is a fifth status, and it is the concurrency claim

The conditional write `paid → cancelling` is what stops two cancels running at
once — the same trick `transitionReservation` uses for a hold, and the _semantic
lock_ countermeasure the saga literature names for exactly this: a compensatable
step marks the record so a second flow can see the first one holding it.
`sagaCommandId` is stable across attempts of **one** saga and says nothing about
two, so it cannot do this job.

⚠️ **The converse is also true, and the build found it the expensive way: the
status cannot do `sagaCommandId`'s job either.** Both a redelivery of one claim
and a rival flow arrive at an order that is already `cancelling`, and the status
alone cannot tell them apart — so the claim route consults the **command inbox**
as well, in the same transaction as the conditional write. Getting this wrong is
not a near-miss: the first build answered a rival the same `200` a redelivery is
owed, and six simultaneous cancels of one order measured **one refund and six
stock restorations**, because every step after the claim is idempotent only on
its own command id. The refund was protected by its unique index on `paymentId`;
the ledger had nothing equivalent, and a vendor was handed back five units nobody
had bought. Two guards, two questions — _is this the same command?_ and _is this
order still claimable?_ — and neither is redundant.

⚠️ **A sequential run proves nothing here.** Six cancels one after another pass
under both the broken and the fixed claim. The test is a parallel burst against a
live fleet, asserting the refund count *and* the movement count.

A stranded cancellation therefore leaves the order visibly `cancelling` rather
than silently wrong, which is the state a sweep or a person can act on.

### 4. Three credentials, three routes, one each

A vendor or operator cancels with a session and
`order-management:product-order:cancel`; a vendor may cancel only an order all of
whose lines name their organization and gets `409` otherwise. A buyer cancels
with the capability below and no session. Each route accepts exactly one
credential — what [ADR 0023](0023-service-to-service-tenant-crossing.md) forbids
is one _route_ taking either, because then the weaker one is the security level.

### 5. The buyer's capability is a storefront-minted nonce, stored as a digest

This is the decision the record exists for, and the obvious design is the wrong
one.

The obvious design has order-service mint an HMAC token over the order id and an
expiry, keyed by a secret, and return it in the `201`. Three things are wrong
with it, and only the first is about cryptography:

- **The `201` is a saga step outcome.** It is persisted in the `saga` store and
  served whole by `GET /api/saga/:id` to any principal whose organization appears
  among the flow's calls. In a two-vendor basket that is _both_ vendors — so a
  bearer token there lets one vendor cancel an order their own session is refused
  with `409 multiVendorOrder`. The authority would be strictly greater than the
  session it was meant to sit beside.
- **The entity envelope has no slot for a sibling field.** `makeEntityEnvelope`
  answers `{ meta, data }`, so the token would have to become a `ProductOrder`
  member — and then it serializes on every vendor's ordinary read of that order,
  which is worse again.
- **A key is a thing to rotate.** Rotating it silently invalidates every live
  capability at once, and there is no version to fall back through.

So the storefront mints 32 bytes of `randomBytes` per checkout, keeps the nonce
in the receipt cookie it already writes, and sends only its **SHA-256 digest**
into the order. order-service compares `sha256(presented)` against the stored
digest in constant time.

```
checkout-action   nonce = randomBytes(32)      digest = sha256(nonce)
       |-- saga inputs: the write-order body carries the DIGEST
       v
saga store        holds the digest   <- vendor-readable, and inert
       |
       v
receipt cookie    holds the nonce    <- httpOnly, the buyer's alone
```

Unsalted SHA-256 is right **only** because the input is 256 bits of randomness
rather than anything a person chose: there is no dictionary to iterate and
nothing to tabulate. It is the shape `RedisOneTimeTokenStore` already uses.

⚠️ **The expiry is a stored timestamp, not a claim.** `cancelWindowEndsAt` is
stamped server-side at placement, which makes the window _revocable_ — clearing
either member ends it — where a signed expiry can only be waited out.

⚠️ **`RECEIPT_TTL_SECONDS` and `order.cancelWindowSeconds` are one number in two
places that cannot import each other.** A window wider than the cookie is a
capability nobody can present; a cookie that outlives the window is a Cancel
button that quietly stops working.

⚠️ **An order with no digest refuses every nonce, including an absent one.** A
counter sale carries none — at a till there is no browser to hold one — and "no
capability was required" must never be reachable from "no capability was
presented".

### 6. order-service holds the coordinator's inbound token, and is a participant

The capability is verifiable only where the order lives, and
[ADR 0056](0056-the-counter-sale-is-the-checkout-saga.md) puts the authority
check where the credential can actually be checked. So order-service becomes the
third holder of that secret and starts a flow in which it is also a participant.

The cycle is deliberate. The alternative — letting the coordinator verify the
capability — would mean handing the digest, the window and the comparison to a
process that declares no domain, and would put an order's authorization rule in a
slice that must not know what an order is.

### 7. The saga, and ADR 0052's reopen trigger

[ADR 0052](0052-the-checkout-saga.md) listed "a saga that fans out across steps
rather than within one" as not built, and named "a second flow is the trigger to
reconsider". The trigger fired. The answer is that **the grammar held**: this
flow is sequential with one fan-out, which `defineSaga` already expresses.

| #   | step                                     | participant     | kind                                        |
| --- | ---------------------------------------- | --------------- | ------------------------------------------- |
| 1   | claim `paid → cancelling`                | order-service   | compensatable, compensation restores `paid` |
| 2   | refund                                   | payment-service | **pivot**                                   |
| 3   | restore stock, one call per line         | stock-service   | retriable, fan-out                          |
| 4   | mark `cancelled`, emit `order.cancelled` | order-service   | retriable                                   |

Step 3 takes its cardinality from the caller's inputs rather than `fanOutFrom`,
because the entry route already holds the lines and each line's `vendorId` is the
`x-organization-id` the crossing needs.

The pivot sits as late as it can and everything before it reverses, which is the
ordering rule the pattern turns on: compensatable steps, then the point of no
return, then steps that may only roll forward.

### 8. A refund is its own entity, and the provider outcome splits with it

ADR 0054 protects the capture row as the evidence a customer was charged. A
`'refunded'` status written over it would erase that evidence by a different
route, so a `Refund` carries its own id, its own provider reference and its own
decision time.

`POST /api/refund` is addressed by **order id** — the saga holds an order and has
never seen a payment — and resolves the capture itself. The amount is copied off
that capture and never read from the request: a body that can name its own amount
can refund more than was ever charged.

Two guards, answering different questions. `x-command-id` claimed in the
transaction covers a **redelivery** of one command; a unique index on the
refund's `paymentId` covers two **different** commands aimed at one capture. A
read before the provider call is what keeps the second case from moving money at
the provider before the index refuses to record it.

⚠️ **`PaymentProviderOutcome` did not grow a `'refunded'` member; a second type
did.** Widening the one union was tried first and the compiler refused it at the
capture route — `payment.status = outcome.status` stopped typechecking, which is
the type system pointing out that a capture could now answer with a refund's
outcome. `RefundProviderOutcome` extends the shared shape by `Omit` and replaces
the one member that differs, so the mistake is unwritable rather than reviewable.

⚠️ **A refused refund emits nothing.** The symmetrical move is to reuse
`payment.failed` as a refused capture does, and it would be wrong: that name
already means _the capture did not happen_, and every note in the fleet about not
consuming it — settlement's especially — was written about that meaning. A second
meaning would make a consumer that later starts reading it silently inherit
refund failures it never reasoned about. The `Refund` row with `status: 'failed'`
is the record, and the caller gets a non-2xx.

### 9. The commission reversal is a signed entry

`CommissionEntry` gains `kind: 'sale' | 'reversal'` and the unique index on
`(orderId, vendorId)` becomes three-key. The reversing row carries **negative**
amounts, so `payoutFor` needs no sign handling — the _storno_ shape, where the
correction is a mirror of the original with the sign flipped and both rows stay
on file, rather than a deletion that leaves a total nothing explains.

A run may therefore produce a **negative** `VendorPayout`, which is a claw-back
against the next period. Allowed, not clamped: clamping it at zero would silently
forgive the money and make the ledger disagree with itself.

Its inputs are `order.cancelled` and `payment.refunded`, joined on the order id
the way ADR 0057's fold already joins two messages — for the same reason, that
neither message alone carries both which vendors and that the money moved.

### 10. Stock restoration is a movement, not an un-conversion

By the time an order is `paid` the hold is `converted`, its sale movement is
written and `onHand` is decremented. There is no hold left to act on, and the
ledger is append-only. `MovementReasons` already declares `cancellation`, and
[ADR 0010](0010-stock-ledger-reservations-and-concurrency.md) named that set as
the extension point, so nothing new is needed in the vocabulary.

⚠️ **Its crossing permission is `stock-management:stock-movement:restore`, not
`stock-movement:write`.** The latter is what a vendor's own session holds for
`POST /api/stock-movement`; naming it here would let a crossing token write that
vendor's whole ledger — any reason, any sign — instead of the one correction a
cancellation makes.

## Consequences

- **The `payment` store holds two entities and the slice two unpaired crossing
  permissions.** `payment-management:refund:write` is **not** the reversal ADR
  0054 says `payment:write` has none of, and filing it as one would be exactly
  backwards: it is a second money movement with its own record, whose own
  reversal question has the same answer — un-refunding is charging a customer
  again.
- **A second tenant crossing exists.** `_shared/planes.md` said the crossing was
  "one named path with one caller (checkout reserving stock)". There are now two,
  and the shape of the rule is unchanged: a named route, a service token _plus_ a
  narrow permission, an explicit organization, and no fallback.
- **`payment.refunded` is published with no consumer.** Settlement grows one in
  M7; it is written now because ADR 0028 requires the announcement to commit with
  the write it announces, and retrofitting an outbox entry later is the dual
  write that rule exists to close.
- **The digest is serialized on every read of the order**, and that is intended.
  It cannot be inverted, it is written `filterable: false` and `sortable: false`
  so it is not a query key, and keeping it off the entity entirely would mean it
  could not arrive off the wire at all.
- **⚠️ `@accessor({ hidden })` could not be used for it, and the reason
  generalizes.** That flag drops a member from **deserialization** as well as
  serialization — the same trap `readonly` is, which `paidAt` already documents —
  so a hidden digest would never arrive and the member would sit permanently
  empty. Hiding an input is a screen's job.
- **⚠️ `filterable` and `sortable` default to _on_ for a scalar.** They are
  written `false` on the digest rather than omitted, because omission is not
  denial and member metadata is the server-side query allowlist. A queryable
  digest lets a caller confirm a guess one request at a time.
- **`Payment.decidedAt` is still written with no accessor.** It is the same
  defect #249 fixed on `ProductOrder.paidAt` — a member without a getter is
  invisible to every adapter — and it is named here rather than fixed, because it
  belongs to a record this change does not otherwise touch.
- **Rate limiting is not built.** No route in this fleet has any; the nonce is
  unguessable, and the worst a valid holder achieves is cancelling their own
  order. Recorded rather than left to be discovered.

## What this does not build

Partial cancellation of a multi-vendor order · returns and RMA · a real provider
behind `refund` · partial refunds, which the unique index on `paymentId` forecloses
deliberately · a payouts process that moves the money a `VendorPayout` names.

## Amends

- [ADR 0052](0052-the-checkout-saga.md) — this record amends its "what this does
  not build" list, whose reopen condition for a graph grammar fired here and was
  answered by keeping the grammar.
- [ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md) — this record
  amends its rejection of "a receipt token on the order", which was reasoning
  about a read, and its statement of what the receipt cookie is worth.
- [ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md) —
  this record amends its claim that the refund is unbuilt and its note that
  `payment:write` is the only unpaired crossing permission.
- [ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md) — this record
  amends its description of the unique index that backstops the fold.
