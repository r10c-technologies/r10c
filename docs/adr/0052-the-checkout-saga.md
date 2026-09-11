# 52. The checkout saga: a definition that is data, and a compensation that is told what it undid

- Status: Accepted
- Date: 2026-09-08
- Area: messaging
- Read when: a flow spans two services and one of them may have to be undone — the definition is data, a fan-out step compensates only the calls that succeeded, and a participant the saga may retry must be idempotent on the command id
- Revised: 2026-09-11 by [ADR 0058](0058-the-order-after-payment.md) — its reopen condition for a step-graph grammar fired, and the grammar held
- Amended by: [ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md) — the pivot this record deferred to M4 landed where it said it would; what it did not anticipate is that `runSaga` ignored `kind` outside definition validation, so the planned pivot would have been decorative and a post-pivot failure would have deleted a paid order

- Amended by: [ADR 0055](0055-a-coordinator-resumes-from-its-own-record.md) — the outbox-entry-plus-HTTP-relay dispatch is struck; the four ways this record said that relay would differ from the AMQP one turned out to be the evidence it was not an outbox

## Context

[ADR 0039](0039-multi-step-sagas-are-orchestrated.md) decided that a multi-step
flow is orchestrated, named the vocabulary, and then deliberately built nothing:

> The decision is in effect; the multi-step engine is not written. What lands
> with this record is the vocabulary, the constraints, and the three corrections
> above.

Three of its four deferred pieces name the same trigger — _"the first multi-step
flow, which is M3's checkout"_. That flow is now being built, so this record
designs it.

### The claim that has to be corrected before anything is designed

[ADR 0010](0010-stock-ledger-reservations-and-concurrency.md) says the
compensation is free:

> If the order write then fails, the compensation releases the reservation,
> which is exactly `rollbackUCFactory` in the existing engine.

It is not. `completeTransaction` hardcodes
`Effect.provideService(OutcomeTag, undefined)`
(`packages/entifix/ts/transactions/src/engine/run-transaction.ts`), and the
reservation ids are minted by stock-service **during** `execute`. A rollback
receives the command and nothing else, so it cannot release holds it never saw.
ADR 0039 measured this and called the parameter _unreachable_; ADR 0010 was
written five weeks earlier and its sentence has been false since. It is
corrected there, in place.

That is not a detail of the engine. It is the whole shape of the problem: **a
compensation is useless unless it is told what its own step did.**

### What checkout actually is

A basket spanning two vendors is two holds in two different tenant databases,
then one order in the platform plane. Three writes, three stores, and
[planes](../_shared/planes.md) forbids them from transacting together. If the
order write fails, both holds must come back; if only the first hold succeeds,
that one must come back and the second must not be attempted twice.

None of that is expressible in the single-step engine, and all of it is ordinary
for a saga.

## Decision

### A step's participant is a configuration key, never a URI

A step names `stock-service`, and the engine resolves an address from
config-service the way every other service-to-service call in the fleet does. A
URI in a definition is a deployment fact written into a business artifact, and
it is the thing that makes a definition untestable and un-relocatable.

The same lookup yields the crossing token for that participant, so a definition
carries no secret and never could.

### Cardinality is data; the structure is static

Checkout reserves once per vendor, and **how many vendors is known only from the
cart**. Writing that as N steps would mean generating a definition per request —
at which point it is no longer data, and ADR 0039's whole construction (a
generic engine walking a declaration, so that no package imports another domain)
collapses back into the class that has no legal home.

So a step declares `fanOut`, and the engine dispatches one call per element of
that step's input. One declaration, N dispatches, N recorded outcomes.

⚠️ **A fan-out step compensates exactly the calls that succeeded.** The failure
this exists for is the partial one: five lines, three holds taken, the fourth
refused `409`. Compensating the step as a unit would either release nothing or
attempt to release two holds that were never taken. The unit of compensation is
the **call**, not the step, and the engine holds an outcome per element to make
that possible.

### At most one pivot — not exactly one

ADR 0039 requires the engine to throw at definition load on more than one pivot,
on a pre-pivot step with no compensation, and on a post-pivot step that declares
one. It did not say whether a definition may have **none**.

It may, and checkout today is the case that forces the answer. Payment capture
is M4; until it lands there is no point of no return, and every step reverses.

⚠️ **The tempting wrong answer is to call the order write the pivot.** It would
satisfy a validator demanding one, it would look right, and it would be wrong in
a way that only surfaces later: when payment lands, the real pivot sits _after_
the order write, so the order write would have to be un-pivoted and its
compensation written retroactively. A validator that forces a false pivot has
made a design decision on the author's behalf.

A definition with no pivot means every step is reversible and the whole saga can
be unwound. That is a stronger property than a pivot, not a missing one.

### The compensation is dispatched with its own call's recorded outcome

The saga record holds, per step and per fan-out element, what the call returned.
A compensation's path is a **template resolved against that outcome**:

```
command:      POST   /api/reservation
compensation: DELETE /api/reservation/{outcome.data.id}
```

Resolution is by field path, evaluated by the engine. It is deliberately not a
callback: a function would be code in a definition, and code in a definition
would need to name the participant's types — the import that has no legal home.

`OutcomeTag` stops being hardcoded on the multi-step path. **The single-step path
keeps passing `undefined`, and that is correct rather than unfinished**: there,
`rollback` runs only on the arm where `execute` produced nothing, so there is no
outcome to pass and never will be. The port's comment says which path it is
describing instead of saying "always".

### A participant the saga may retry must be idempotent on the command id

This is the finding that costs the most to act on and the most to skip.

The command id is `<sagaId>:<stepId>` (with the element index appended on a
fan-out), the shape ADR 0039 already fixed. It travels as a header, and the
participant claims it in the **same storage transaction as its side effect** —
which is exactly #178's `TransactionInbox`, already built and already exercised
by the saga tracker's fold.

⚠️ **Without this, an at-least-once dispatch oversells.**
`POST /api/reservation` mints a fresh `randomUUID()` per call today, so a
redelivered command takes a **second** hold against the same line. The first is
then owned by nobody, holds stock until the sweep, and the ledger is correct at
every step while the vendor's availability is quietly wrong. That is the class
of bug the reservation design exists to make impossible, reintroduced above it.

So the crossing routes take an idempotency key and claim it. This does **not**
weaken the server-owned id rule that `take-reservation.ts` records: the caller
still cannot choose the reservation's identity, and a session caller presents no
key at all. What the key buys is that a repeat of the _same command_ returns the
hold it already took, rather than taking another. It is ADR 0028's rule pointed
at commands instead of events — the client mints the id, the id is the
idempotency key — which the fleet already runs on.

### The dispatch is an outbox entry whose relay speaks HTTP

> **Amended 2026-09-09 by [ADR 0055](0055-a-coordinator-resumes-from-its-own-record.md).**
> Not built. Each difference listed below is a way the "relay" would have behaved
> unlike a relay — walking one database, writing the response back before the
> next step, telling a refusal from a failure — and all three are things the
> engine does inline. The persist-before-dispatch rule is unchanged; what carries
> it is `beginStep` on the instance.

ADR 0039's rule, unchanged: persist the step transition, then dispatch it. What
this record adds is how the HTTP relay differs from the AMQP one it sits beside
(`apps/marketplace-admin-service/src/outbox/relay.ts`):

- **It walks one database, not many.** The saga's entries live in the
  control-plane `saga` store, single-partitioned. The AMQP relay walks every
  `tenant_`-prefixed database because the entries it drains are per-organization.
- **It writes back.** A publish is done when the broker acks it; a command's
  **response is the step's outcome**, and it must be recorded before the next
  step is dispatched, or the compensation above has nothing to read.
- **It distinguishes a refusal from a failure.** A `409` from reserve is the
  business answer "not enough stock" and fails the saga forward into
  compensation. A `503` is a participant that is down and the entry is retried.
  Collapsing the two would either retry an out-of-stock line forever or
  permanently fail a checkout because a pod was restarting.
- **Quarantine is the same mechanism.** ADR 0030's attempt counter and its
  surfaced log apply unchanged; a stranded saga is logged rather than swallowed,
  which is ADR 0039's own instruction.

### The coordinator runs as its own process

ADR 0039 deferred this with a stated trigger: _"The first flow with a
participant outside marketplace-admin-service is the trigger."_ Checkout's
participants are stock-service (`:3108`) and order-service (`:3105`). **The
trigger has fired**, and the `transaction` slice takes the `:3103` that
`_shared/ports.md` has been holding for it.

Ownership does not move — the `saga` store has one writing slice either way — so
this is ADR 0021's cheap direction: pointing `deployments` at a new app, not
untangling a database.

### order-service writes its event in the same transaction as the order

`order.placed` and `order.cancelled` are declared on the slice, and their only
consumer is the `planned` payment slice — so the queue is empty until M4, by
design and on the register.

They are still written now, into an outbox in the `order` store, committed with
the order. The alternative is to add the event later as a second write, which is
precisely the dual write ADR 0028 exists to close: a crash between the two leaves
an order nobody was told about, or an announcement of an order that rolled back.
Retrofitting an outbox under a store that already has rows is strictly more work
than opening one with it.

## Consequences

- **A definition is inspectable and diffable.** "Where did order 4471 stop, and
  what has been reversed" is a read against the `saga` store, which is the
  concrete thing ADR 0039 chose orchestration for.
- **The crossing routes grow an idempotency key**, and stock-service gains a
  per-tenant inbox collection beside its ledger. That is the real cost of this
  record, and it is paid to keep an at-least-once transport from overselling.
- **transaction-service holds a crossing token per participant.** ADR 0023's
  recorded residual carries over unchanged and gets no worse in kind: any process
  holding one can name any organization, and this raises the value of one process
  rather than creating a new class of risk. The named upgrade path is still an
  RS256 service token minted by auth-service, giving a call an identity rather
  than a password.
- **The fleet gains two processes**, `:3103` and `:3105`. The health ladder walks
  both.
- **Nothing is faster.** Orchestration adds a hop per step, paid only by flows
  that opt in. Single-step writes are untouched.
- **`fanOut` is a shape the register cannot check.** `@r10c/slices` validates
  stores, domains, events and deployments; a definition's step list is validated
  at load by the engine and nowhere else. A definition that never loads is a
  definition that never fails, so every definition is loaded in a spec.

## What this does not build

- **Timers, conditionals and human tasks in the definition grammar.** ADR 0039
  set this as the reopen condition for adopting a durable execution engine, and
  it stands: if the grammar grows any of them, we are writing a workflow engine
  and should adopt one instead of finishing it.
- **The pivot's semantics under a real capture.** M4 adds the payment step and is
  where `retriable` first has a member.
- **A saga that fans out across steps rather than within one.** Checkout needs
  fan-out inside a step and sequential steps around it; a general graph is not
  built, and a second flow is the trigger to reconsider.

  > **2026-09-11 — the trigger fired, and the answer was to keep the grammar.**
  > The cancellation flow ([ADR 0058](0058-the-order-after-payment.md)) is the
  > second flow: claim, refund, restore stock per line, settle. It is sequential
  > with one fan-out, which `defineSaga` already expresses, so nothing here
  > changed. The condition stands for a third flow that genuinely needs a graph.

## Amends

- [ADR 0010](0010-stock-ledger-reservations-and-concurrency.md) — its claim that
  the existing engine's `rollbackUCFactory` compensates a reservation is
  corrected in place. Every decision in that record stands: the ledger shape, the
  two counters, the conditional atomic write, and the prohibition on a
  distributed lock per decrement.
- [ADR 0039](0039-multi-step-sagas-are-orchestrated.md) — its deferred pieces are
  designed here and its `:3103` trigger has fired. Every decision in that record
  stands: orchestration per flow, Richardson's classification, commands over HTTP
  and results over the bus, the outbox before the dispatch, and the rejection of
  a durable execution engine on the stated reopen condition.

[ADR 0023](0023-service-to-service-tenant-crossing.md),
[ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
and [ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) are applied here,
not changed.
