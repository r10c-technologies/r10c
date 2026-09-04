# 39. Multi-step sagas are orchestrated, per flow, from a declarative definition

- Status: Accepted
- Date: 2026-09-04

## Context

The engine runs **one** step in **one** service, and every part of it says so.

`TransactionCommand.type` is the literal `'create'`, with a comment admitting
"only `create` in phase 1". `executeUCFactory()` is a single call into
`handler.execute(command)`. `TransactionStep` is
`'accepted' | 'completed' | 'failed'` — three values, none of which is a step
index. There is no step list, no ordering, and no per-step compensation
anywhere in `packages/entifix/ts/transactions`.

That is not a gap in the engine. It is the whole engine, and it is correct for
what it does: assign a code, write one entity, announce it.

**Checkout is a different shape.** Reserve stock → create order → capture
payment → publish. Four steps, three slices, three stores, in three databases
that [planes](../_shared/planes.md) forbids from transacting together. Growing
`TransactionHandler.execute` to cover it would put a cross-slice write inside one
method whose contract is "write it in the same storage transaction as the outbox
entry" — which is exactly the thing that cannot be done here.

### The claim this contradicts, and where it actually lives

`docs/ARCHITECTURE.md` states: _"It is **choreography** — the service owns its
transaction and emits events; the saga tracker only observes and recovers
(passive)."_ Multi-step compensation is normally orchestration, so whichever way
this goes, that sentence changes.

Issue #105 says the claim is in `CLAUDE.md`. It is not. `grep` finds it in four
places, none of them CLAUDE.md: `docs/ARCHITECTURE.md`,
`apps/marketplace-admin-service/src/mongo.ts`,
`apps/marketplace-admin-service/src/saga/tracking.ts`, and
`packages/entifix/ts/transactions/src/contracts/event.ts`. The issue also asks
for ADR 0011's reciprocal line; ADR 0011 is _organization provisioning and
migrations_ and has nothing to do with sagas. The record this amends is
[ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md).

### Three things measured while deciding, all of them small and all of them real

**`rollback` is structurally told nothing.** `completeTransaction` hardcodes
`Effect.provideService(OutcomeTag, undefined)`, the port declares
`outcome: TransactionOutcome | undefined`, and the only implementation
(`catalog-transaction-handler.ts`) writes `rollback: command =>` and ignores the
parameter. The doc comment says it "runs whether or not `execute` produced an
`outcome`", implying the value is sometimes defined. It never is, and it cannot
be while there is one step: `rollback` runs only on the failure arm, where
`execute` produced nothing. The parameter is not unused — it is _unreachable_,
and a multi-step saga is the thing that makes it reachable.

**A failed compensation reaches nobody.** The rollback is wrapped in
`Effect.ignore`, and that is correct and deliberately tested — a client polling
for a terminal state must still get one, which
`run-transaction.spec.ts`'s "still records failure and frees when rollback itself
fails" protects. But the rollback's _own_ error is then discarded entirely. The
recorded event carries `error: 'write failed'` — the `execute` error — and
`'rollback failed'` appears in no log, no record and no metric. An operator
reading `FAILED` reasonably concludes the write was undone. This is the failure
class the literature says is the one nobody plans for, and it is already live in
a single-step engine.

**`TransactionStore.list()` has no callers.** #194 deleted
`GET /api/transaction` — an unauthenticated, unscoped index of every
organization's transactions — and left the port method and its Mongo
implementation behind.

## Decision

### Orchestration, per flow, and single-step writes do not change

A multi-step flow is **orchestrated**: one coordinator decides the order, holds
the progress, and issues each step. A single-step write keeps today's
choreography untouched — the catalog transaction is not rewritten, not wrapped,
and not made to pay coordinator cost for a thing that has one step.

This is the hybrid most systems arrive at, and the reasoning is specific rather
than a preference for central control. Checkout has conditional logic, parallel
steps, and will change often; those are the three conditions under which
choreography's implicit state stops being an advantage and becomes the reason
nobody can answer "where did order 4471 stop". Choreography's real benefit —
no central dependency — is worth most where the flow is stable and 3–4 steps.
Ours is neither.

The opt-in matters as much as the choice. Making orchestration global would
rewrite a working path to gain nothing, and "every write is a one-step saga" is
the kind of uniformity that costs at runtime forever to save a paragraph here.

### The step definition is declarative data, because it is not allowed to be code

An orchestrator that knows checkout's four steps must reference
`stock-management`, `order-management` and `payment-management`. A
`business:domain` package **may not import another domain**
([layering](../_shared/layering.md)), and no other layer is lower than all three.
There is no legal home for that class.

So the flow is **data**: a `SagaDefinition` naming steps, each with an id, the
participant's address, the command to send, the compensation to send, and its
classification. A generic engine in `packages/entifix/ts/transactions` walks it.
Nothing imports anything, the boundary rule is untouched, and the constraint that
looked like an obstacle is the design.

This is the same move `makeEntityCrud` made against the empty implementation
layer: the thing that seemed to need a per-domain component turned out to be
derivable from a declaration.

### Steps are compensatable, pivot, or retriable — and the engine enforces it

The classification is Richardson's, and adopting the vocabulary is most of the
answer to "which steps are compensable at all":

- **compensatable** — before the point of no return; a failure downstream
  reverses it.
- **pivot** — the point of no return. Once it commits, the saga goes forward.
- **retriable** — after the pivot; no compensation exists, so the only path is
  to retry until it succeeds.

For checkout: reserve stock and create order are compensatable, **capture payment
is the pivot**, publishing and notifying are retriable. Designing a flow is
largely deciding where the pivot sits and making sure everything before it can be
reversed.

The engine **throws at definition load** on a definition that violates the shape:
more than one pivot, a pre-pivot step with no compensation, or a post-pivot step
that declares one — the last because such a compensation could never run, so
writing it is a false assurance rather than dead code. It throws on load rather
than at the step, the same reasoning ADR 0035 used for `collection` +
`determining`: a fault that only appears on the unlucky path is a fault that
ships.

### Compensation is a semantic reversal and gets its own events

A refund is not an uncharge. It is a new business operation with its own record,
its own timing and possibly its own fee, and it appears on the customer's
statement as a separate line. So a compensation is a **step**, not an undo hook:
it emits `transaction.compensated` on success and
`transaction.compensation-failed` on failure, and the saga's state distinguishes
"failed and reversed" from "failed and stranded".

A failed compensation is retried with backoff and then, on exhaustion, **surfaced
rather than swallowed** — a stranded saga that nobody is told about is the same
as a lost one, and it is the state that leaves a reservation held and a customer
charged. ADR 0030 already built the mechanism shape for this (quarantine, and a
log the sweep makes visible); this extends the same treatment to compensation.

Immediately, and independent of any multi-step work: the single-step engine
**logs** its rollback failure, matching `outbox/relay.ts`'s
`Effect.logError('outbox entry quarantined')`. The `Effect.ignore` stays — the
client must still receive a terminal state — but the error stops vanishing.

### Commands go out over HTTP; results come back over the bus

A participant is invoked through its **own existing route**, over
[ADR 0023](0023-service-to-service-tenant-crossing.md)'s path: a service token
plus the narrow route permission. Its outcome arrives as its own `transaction.*`
event on the bus, which the coordinator subscribes to.

The asymmetry is deliberate and is the point. HTTP gives a **synchronous
rejection** — a malformed step is a `400` before the saga has state to unwind,
which is the same split `acceptTransaction` already draws at the `202` boundary.
The bus gives **durable at-least-once completion**, which is what a step that may
take minutes needs. Using one transport for both would give up whichever half it
was not chosen for.

Rejected: **a command exchange on the bus** (`entifix.commands` beside
`entifix.events`). It is symmetric and it inherits ADR 0030's retry and
quarantine for free, and it fails on authorization: there is no principal on an
AMQP frame, so a command message would need its own authentication scheme
invented beside the one the fleet already has. It also needs a command vocabulary
in `tools/slices/`, without which ADR 0031's `/api/$service` diff stops seeing
half the fleet's traffic — a check going quietly blind is worse than a check that
does not exist.

ADR 0023 is **applied here, not widened**. It stays one named path with one
determined caller; the orchestrator is the process making the call on checkout's
behalf, not a new kind of crossing. Its recorded residual carries over unchanged,
and the coordinator becoming a holder of several service tokens is noted below.

### The dispatch goes through the outbox

[ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)'s
rule extended from events to commands: **persist the step transition before
dispatching it**. A coordinator that marks a step in flight and then makes the
call has the dual write ADR 0028 exists to close, with the same consequence — a
crash between the two leaves a step that either ran twice or never ran, and the
record says the opposite of the truth.

So a step dispatch is an outbox entry whose relay performs an HTTP POST rather
than an AMQP publish. This is **the one genuinely new mechanism** and the largest
build item; everything else here reuses machinery that exists.

### Idempotency reuses the inbox and its key

A step's command id is `<sagaId>:<stepId>`, the same shape as `event.id`'s
`<transactionId>:<step>`. So #178's `TransactionInbox` — a consumer claiming an
id in the same storage transaction as its side effect — serves saga steps with no
second dedup store and no second key. The register's `dedupe` field still lands
with #178 rather than here, for the reason it was withheld: a declaration nothing
enforces is the defect ADR 0020 struck a phantom store for.

Retriable steps must be idempotent by construction, because after the pivot
retrying is the only path left.

### Isolation is a semantic lock, never the infrastructure lock

Sagas have no isolation, and the countermeasure here is the **semantic lock** —
a status on the record that tells a concurrent reader the value is in flight.
`PENDING` already is one.

What must not happen is holding the Redis lock across steps. It is acquired per
command and released by `free`; spanning a payment capture it would be held for
the length of a network call to a third party, and a lost lock owner would then
block that resource until its TTL rather than for a moment.

### `source` is still never a consumer branch

[ADR 0029](0029-the-event-envelope-and-a-routed-bus.md) holds unchanged: the
coordinator branches on `event.name` and on its own persisted state, never on
which slice sent the message. An orchestrator is exactly the component tempted to
do otherwise, which is why it is restated rather than assumed.

### The coordinator lives in the `transaction` slice, in the `saga` store

A saga instance is a transaction's state with steps in it, so it belongs in the
store that already holds transaction state. No new store, and the `transaction`
slice keeps `domains: []` — orchestration is a mechanism, not a business domain,
and giving it one would put a domain name in the permission namespace and the
entitlement key for something no organization is ever provisioned for.

**Splitting the slice out to `:3103` is named and deferred.** A coordinator
co-deployed inside its only participant is fine today. The first flow with a
participant outside marketplace-admin-service is the trigger, and the split is
what ADR 0021 said it was: pointing `deployments` at a new app, not a data
migration. The port stays reserved.

### Rejected: adopting a durable execution engine

Temporal and Restate solve this problem properly, and their own argument is
pointed at us: _the time to migrate is when you find yourself building state
tables, custom retry logic, or DLQ consumers with business logic — you are
already building a workflow engine_. We have all three.

Rejected now for three reasons that are about this repository rather than about
the tools. It is a **second programming model beside Effect**, in a codebase
whose entire dependency story is `Context.Tag` + `Layer`. It is a **cluster the
health ladder has to learn** — `infra/local/ensure.sh` would gain a rung, a
readiness probe and a seed, for a capability nothing yet calls. And it
**displaces ADR 0028's outbox** rather than extending it, discarding the one
piece of this problem that is already built and correct.

**The reopen condition, stated so it is not a matter of taste**: if the
definition grammar grows conditionals, timers, or human tasks, we are writing a
workflow engine and should adopt one instead of finishing it.

## Consequences

- **The choreography claim is now conditional**, and is corrected in all four
  places it is written rather than in the one the issue named.
- **`TransactionHandler` grows a second shape and keeps the first.** A
  single-step handler is unchanged, which is what makes this a cheap decision to
  live with rather than a migration.
- **The coordinator holds service tokens for every participant it invokes.** That
  concentrates the secret ADR 0023 already recorded a residual for: any process
  holding one can name any organization. It does not create a new class of risk,
  it raises the value of one process. The named upgrade path is the same one —
  an RS256 service token minted by auth-service, giving the call an identity
  rather than a password.
- **A saga's state is queryable**, which is the concrete thing choreography would
  not have given: "where did this stop and what has been reversed" is a read
  against one store rather than a correlation across service logs.
- **Nothing is faster.** Orchestration adds a hop per step. That is the price for
  the previous point, paid only by flows that opt in.
- **The pivot is now a modelling obligation.** Someone has to decide, per flow,
  which step is the point of no return — and a flow with two of them is a flow
  that has not been designed yet, which the engine will say out loud.

## What this does not build

The decision is in effect; the multi-step engine is not written. What lands with
this record is the vocabulary, the constraints, and the three corrections above.
What each remaining piece waits on:

- **The `SagaDefinition` type and its load-time validation** — the first
  multi-step flow, which is M3's checkout.
- **The HTTP-dispatching outbox relay** — the same trigger; it has no other
  caller.
- **`rollback` receiving its step's outcome** — the multi-step engine is what
  makes the parameter reachable, so the signature changes there and not before.
  Until then the comment says plainly that it is always `undefined`.
- **The compensation events and the stranded-saga surface** — with the engine.
  The single-step log lands now.
- **Step-level deduplication** — #178's `TransactionInbox`, unchanged in scope.
- **Splitting the `transaction` slice to `:3103`** — the first participant
  outside marketplace-admin-service.

## Amends

- [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
  — the engine gains a multi-step, orchestrated mode, and the persist-before-
  publish rule extends from events to command dispatch. Every decision in that
  record stands: the client mints the id, the id is the idempotency key, the
  engine never publishes, `completed` is written by the handler in the same
  storage transaction as its state change.

[ADR 0023](0023-service-to-service-tenant-crossing.md) and
[ADR 0029](0029-the-event-envelope-and-a-routed-bus.md) are applied here, not
changed.
