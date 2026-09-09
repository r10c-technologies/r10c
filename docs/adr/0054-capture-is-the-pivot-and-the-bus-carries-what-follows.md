# 54. Capture is the pivot, and the bus carries what follows

- Status: Accepted
- Date: 2026-09-09
- Area: messaging
- Read when: money has to be taken inside a flow, or a saga step fails after the point of no return — capture is a dispatched step and never a subscription, and a post-pivot failure rolls forward or strands, never back

## Context

M4 promotes the `payment` slice, and the repository held **two incompatible
designs** for how a payment gets taken. Both were written down, both were
plausible, and only one could be built.

**The register said the bus drives it.** `payment.slice.ts` subscribed to
`order.placed` with `mode: 'work'` and `dedupe: 'inbox'`, and `order.slice.ts`
subscribed to `payment.captured` and `payment.failed`. Read together, that is an
event-driven capture: the order lands, a message arrives, money is taken, and two
more messages carry the result back.

**[ADR 0052](0052-the-checkout-saga.md) said the saga drives it.** It declared
checkout deliberately pivot-less and said so in the definition's own source:

> ⚠️ **No pivot, deliberately.** Payment capture is the point of no return and
> it lands in M4; until then every step here reverses, which is a stronger
> property than a pivot rather than a missing one.

and in its consequences: *"M4 adds the payment step and is where `retriable`
first has a member."*

Neither document knew about the other's answer. Left alone, whoever wrote the
first payment route would have decided it, and the register would have gone on
describing a flow that did not exist.

### The defect underneath the question

Deciding for the saga surfaced something worse, and it was already in the engine.

`runSaga` unwinds **every step it has taken** on any failure. It has no pivot
awareness at all — `SagaStepKind` is validated at definition load by `defineSaga`
and then never consulted again. `compensateStep` returns an empty list for a step
that declares no compensation, which a `pivot` and a `retriable` step never do.

So the moment a `capture-payment` pivot existed, a failure in the step after it
would have walked backwards, no-opped politely past the capture, and then issued
`DELETE /api/product-order/:id` and released every hold. The buyer is charged,
the order is gone, the stock is back on sale, and every probe stays green. That
is the failure ADR 0052 named in the abstract; it was one step away from being
reachable.

## Decision

### 1. Capture is a saga step, and it is the pivot

`POST /api/payment` is dispatched by transaction-service as the third step of
the checkout definition. It is not triggered by a message.

The buyer is standing at a checkout and needs a yes or no now — the same argument
[ADR 0010](0010-stock-ledger-reservations-and-concurrency.md) uses for reserving
synchronously rather than queueing it. An event-driven capture would answer the
buyer "we will let you know", and the hold backing their basket expires in
minutes.

The pivot sits **after** the order write, which is exactly where ADR 0052
predicted it and exactly why that record refused to let the order write be called
one. Nothing had to be un-pivoted.

### 2. Converting the reservation is a post-pivot `retriable` step

`POST /api/reservation/:id/conversion` already existed and was already guarded by
a crossing token. It becomes step four, fanning out one call per hold taken.

It is dispatched rather than driven by `payment.captured` for two reasons, and
the second is decisive. The hold has a TTL measured in minutes, so the conversion
belongs on the synchronous path. And it is a crossing into a vendor's tenant
store — order-service holds no crossing token, holds no organization on a buyer's
session, and never will
([ADR 0023](0023-service-to-service-tenant-crossing.md)). transaction-service is
the one process that holds both halves.

### 3. The engine learns the pivot, and rolls forward or strands

`runSaga` tracks whether a `pivot` step **committed** — not whether the
definition declares one, because a pivot that refuses is still fully reversible
and is the ordinary compensation case.

- **Before the pivot** — unchanged. Unwind every taken step.
- **After the pivot** — never compensate. Retry the failing step a small fixed
  number of times, then settle `STRANDED` and log at error level.

The retry is small and immediate on purpose: it exists to ride out a participant
restarting, not to be a retry policy. Re-dispatching is safe for exactly one
reason — `sagaCommandId(sagaId, step.id, index)` is stable across attempts, so a
participant idempotent on the command id recognises the replay. ADR 0052 stated
that requirement on participants; this is the code that now depends on it.

Durable retry across a **coordinator** restart is a different mechanism and is
still not built. #233 holds it.

### 4. The bus carries what follows, and only that

`payment.captured` and `payment.failed` are still published, from an outbox in
the `payment` store written in the same Mongo transaction as the `Payment`.
What changes is who they are for: consumers of the *consequence*, never
participants in the decision.

- **order-service consumes `payment.captured`** and advances the order from
  `pending` to `paid`. This is the part that can safely be late — a receipt's
  status, not a hold on stock.
- **settlement will consume it** in M6, unchanged.

Two declarations are corrected to match:

- **`paymentSlice.subscriptions` becomes `[]`.** It no longer subscribes to
  `order.placed`. The idempotency that declaration asked for did not disappear
  with it; it moved to where the dispatch actually arrives, as a command-id claim
  in the same transaction as the write. `dedupe: 'inbox'` guards a *message*, and
  this route is not reached by one.
- **`orderSlice` drops `payment.failed`.** A refused capture is the pivot
  refusing, which compensates the flow and **deletes** the order. A consumer
  writing `status = 'cancelled'` onto that same order would be racing its own
  deletion, and whichever won would be arbitrary.

### 5. `order.placed` has no consumer, and is drained anyway

This is the part that looks like a contradiction and is not.

The payment slice was the only declared subscriber, and it is no longer one. The
entry is still written, because ADR 0028 requires the announcement to commit with
the write it announces, and retrofitting an outbox under a store that already has
rows is strictly more work than opening one with it.

The **relay** is built now regardless, because an outbox nothing drains is a
backlog with no ceiling and no gauge — the defect #232 recorded. order-service
needs a broker connection for its `payment.captured` subscription in any case, so
the relay costs one layer beside it.

## Consequences

- **The order state machine closes.** An order reaches `paid` and a reservation
  becomes a sale movement. Before this, both terminated at `pending` and expired
  on TTL forever.
- **A refusal answers `402` and still writes.** The `Payment` row and the
  `payment.failed` entry are the record that an attempt happened, which
  reconciliation needs; the non-2xx is what tells the coordinator the pivot did
  not commit. Answering `200` with a failed body would roll a saga forward past a
  payment nobody made.
- **A replayed command answers what the first attempt decided**, status and all.
  A redelivered command that had been declined stays declined, because telling
  the coordinator otherwise on the second delivery is the same bug from a
  different direction.
- **The single-database outbox relay is now shared**, in
  `entifix-ts-mongo-client` beside the Mongo store it drives. Three slices own an
  outbox, and an Effect metric is keyed on its description — three hand-written
  definitions of `outbox_pending_entries` are three series the moment one wording
  drifts, and a dashboard would go quiet without failing anything.
- **`payment-management:payment:write` is the first unpaired crossing
  permission.** Every other entry in `SERVICE_CROSSING_PERMISSIONS` has its
  reversal beside it, because every other step is compensatable. This one has
  none: a refund is a new record with its own money movement, not the absence of
  this one — ADR 0039's *"a refund is not an uncharge"* — so a delete permission
  would authorize erasing the evidence that a customer was charged.
- **The fleet gains a process**, `:3106`. The health ladder walks it.

## Residual

**A payment read is guarded but not scoped**, and `payment-management:payment:read`
is therefore granted to `admin` and above rather than to `user`.

[ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md) narrows a
platform-plane read by conjoining a predicate built from the verified principal
onto the load request. That treatment needs something on the record to key on,
and a `Payment` carries an `orderId` and a `channelId` and neither a buyer nor a
vendor. There is nothing here to conjoin.

Granting the read to `user` without a scope would let any signed-in account read
every payment on the platform, so the grant waits for the scope rather than the
scope waiting for someone to notice. The two candidate fixes are a denormalized
`buyerId` on the payment, or resolving the scope through order-management's own
use-case port — which is the shape `_shared/planes.md` prescribes for a
cross-store reference and the more likely answer. A buyer reads their payment
status through the order it belongs to in the meantime, which is where a receipt
is read anyway.

## Amends

- [ADR 0052](0052-the-checkout-saga.md) — its "no pivot, deliberately" holds for
  the definition as it stood, and its stated reason is now discharged rather than
  contradicted: M4 landed, and the pivot went exactly where that record said it
  would. What it did not anticipate is that the engine ignored `kind` outside
  definition validation, so the pivot it planned for would have been decorative.
