# 55. A coordinator resumes from its own record, and a dispatch needs no outbox

- Status: Accepted
- Date: 2026-09-09
- Area: messaging
- Read when: a saga has to survive its coordinator dying, or you are about to build the command outbox two earlier records specify — the instance is already the durable record of intent, and where to resume is derived from the outcomes rather than stored beside them

## Context

[ADR 0039](0039-multi-step-sagas-are-orchestrated.md) and
[ADR 0052](0052-the-checkout-saga.md) both specify the same mechanism for making
a step dispatch durable, and ADR 0039 sizes it:

> So a step dispatch is an outbox entry whose relay performs an HTTP POST rather
> than an AMQP publish. This is **the one genuinely new mechanism** and the
> largest build item; everything else here reuses machinery that exists.

[ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md) left
it unbuilt and named its holder: _"Durable retry across a **coordinator**
restart is a different mechanism and is still not built. #233 holds it."_

So the mechanism was decided twice and deferred twice. Building it now meant
first asking what it would actually add, and the answer turned out to be less
than the records assumed — because the engine that was built in the meantime
already writes most of what durability needs.

### What the coordinator already persists

`runSaga` was built to ADR 0039's persist-before-dispatch rule and honours it
exactly. Per step, in order: `beginStep(sagaId, index)` **before** the dispatch,
then `recordOutcome` with one entry per fan-out call, carrying each call's
status, body and `organizationId`. On a refusal it writes `COMPENSATING`, then
`COMPENSATED` or `STRANDED`.

That is not a report on a flow. It is the flow's state, written at every point
where it changes, in the store the `saga` slice owns. What it lacked was one
member — the caller's `inputs` — without which a *different process* reading it
knows which step is next and has nothing to dispatch it with, because a fan-out
step's cardinality is its input's length.

### The three things that were actually broken

Building #233 meant reading the code rather than the records, and three facts
turned up that neither record anticipated:

1. **`SagaStore.findStale` had no caller.** It was written, implemented over
   Mongo, and deliberately counts `COMPENSATING` as stuck — the state that
   leaves holds in place — and nothing ever looked. The instances were there,
   correct, and unobserved. ⚠️ The recovery sweep in `saga/tracking.ts` is a
   *different* one: it walks `TransactionStore`, a port with the same method
   name and single-step transaction records behind it.

2. **A participant `5xx` aborted the walk without compensating.** The HTTP
   dispatcher turns a transport failure or a `5xx` into an `EntifixConnError`,
   which lives in `runSaga`'s **error channel** — and the walk does not catch
   it. So a pre-pivot failure against a restarting participant propagated out
   past the compensation logic entirely: the route answered `500`, the holds
   stayed, and the instance sat `RUNNING` forever. This is a worse failure than
   the one #233 was filed for, it is reachable without any coordinator dying,
   and nothing had recorded it.

3. **A resume could not tell a finished step from a refused one.**
   `SagaStepOutcome` recorded the calls that succeeded and not whether the step
   went on to fail, so the two are indistinguishable on the stored document —
   and that distinction is exactly what decides whether the pivot committed.

## Decision

### The instance is the durable record; there is no command outbox

The outbox pattern exists to close a **dual write**: a state change in a
database and a message to another system, which cannot be made atomic, so the
message is written into the same transaction as the state and relayed
afterwards.

A saga step is not that shape. The "message" is an HTTP call **whose result is
needed inline** — a command's response *is* the step's outcome, which ADR 0052
already noticed when it wrote that the HTTP relay, unlike the AMQP one, "writes
back". And the state change the entry would be written beside is
`beginStep`, which is already persisted before the dispatch. An entry per call
would therefore hold: the participant and path (in the definition), the body
(in `inputs`), the command id (`sagaCommandId`, derived), and the response
(recorded as the outcome). Every field is a copy of something the instance
holds or the definition determines.

⚠️ **Two records of one fact can disagree, and this pair would have to be
written in the same breath.** The outcome would land on the entry and on the
instance, and a crash between them leaves the store contradicting itself — the
precise failure the outbox exists to prevent, reintroduced by adding one.

So: **no `saga_commands` collection, no HTTP relay.** `SagaInstance` gains
`inputs` and `resumeAttempts`, `SagaStepOutcome` gains `error` and
`compensated`, and a sweep finishes what a dead coordinator started.

What is given up is per-call attempt counting with ADR 0030's quarantine
vocabulary. `resumeAttempts` on the instance replaces it with the same
ceiling-then-surface shape at flow granularity, which is the granularity a
stranded flow is actually acted on at: nobody retries one call of a checkout.

### Where to resume is derived, never stored

A resume pointer written beside the outcomes would be a second record of the
same fact again. The outcomes say what happened and `beginStep`-before-dispatch
means `stepIndex` says what was attempted, so four exhaustive cases fall out:

| The instance says                          | The coordinator died           | So                                        |
| ------------------------------------------ | ------------------------------ | ----------------------------------------- |
| no outcome for the step at `stepIndex`     | during the dispatch            | re-dispatch it                            |
| a successful outcome for it                | after `recordOutcome`          | start at the **next** step                |
| an outcome carrying `error`                | deciding what to do about it   | re-enter that decision                    |
| state `COMPENSATING`                       | mid-unwind                     | continue, skipping `compensated` steps    |

⚠️ **The second row is the one that would oversell.** Re-dispatching at
`stepIndex` after the outcome was recorded takes a second set of holds against
the same lines — the exact bug ADR 0052 built the command inbox to stop,
arriving from the coordinator instead of from a redelivery.

Re-dispatching in the first row is safe for the reason ADR 0052 stated as a
requirement on participants and ADR 0054's post-pivot retry already depends on:
`sagaCommandId(sagaId, stepId, index)` is stable across attempts, and every
participant claims it in a `command_inbox` in the same transaction as its side
effect. A replay answers what the first attempt decided.

### A compensation answering `404` has already been undone

Compensation becomes at-least-once the moment a resumed coordinator can retry
it. A participant answering "no such record" on the second delivery is
describing a flow that **was** reversed, so counting that as a refusal would
strand exactly the sagas that were cleaned up correctly.

This is the same reasoning ADR 0054 recorded from the other side, where
`POST /api/reservation/:id/conversion` is built deliberately *total* so that an
at-least-once compensation cannot error on redelivery. Here it is the caller's
half of that contract.

`compensated` on the outcome is what makes the common case not need the rule at
all: a step already given back is skipped rather than re-dispatched. It is
marked only when the step came back whole, so a partial failure is retried.

### The sweep claims before it resumes

`findStale` then `claimForResume`, which is one conditional write that
increments `resumeAttempts` and re-stamps `updatedAt`. Two consequences, and
both are the point:

- A second replica's claim finds the instance no longer stale and skips it.
  Without this two coordinators walk one flow together — survivable, because the
  participants deduplicate, but every call is doubled and the attempt ceiling
  counts two per tick.
- **This** sweep's next tick does not re-pick the instance it is still working
  on.

⚠️ **The staleness window must stay above the longest a step legitimately
takes.** `updatedAt` is re-stamped before every dispatch, so a slow participant
keeps its instance fresh — but a step slower than the window is resumed
underneath a coordinator still waiting on it.

### A stranded flow is surfaced, and that needed a metric

ADR 0039 is explicit that a stranded saga nobody is told about is the same as a
lost one, and until now the only surface was a log line nothing counted.
`saga_stale_instances` and `saga_resumes_total` are declared beside
`transactions_by_state`, with panels, because `@r10c/docs-check` matches
declared metrics against the dashboard's PromQL in both directions.

⚠️ The gauge is dimensionless, so it reaches Prometheus as
`saga_stale_instances_ratio` ([ADR 0001](0001-observability-and-tooling.md)).

### The read that orchestration was chosen for

ADR 0039 justified orchestration over choreography with one concrete claim:

> **A saga's state is queryable** … "where did this stop and what has been
> reversed" is a read against one store rather than a correlation across service
> logs.

`GET /api/saga/:id` is that read. It is session-guarded and carries **no
permission of its own**: the `transaction` slice declares `domains: []`, and a
permission is `<domain>:<entity>:<action>`, so inventing one here would put a
domain name in a namespace nothing is provisioned for
([ADR 0005](0005-business-domain-decomposition.md)).

⚠️ **The scope is derived from the calls the flow made**, because a flow has no
single organization — a basket spanning two vendors takes holds in two tenant
databases, and both vendors have a claim on the record. The platform-plane steps
carry none at all. An instance that died before its first call therefore belongs
to nobody and is readable by nobody, which is the direction to fail; it is not
invisible, because the sweep's log and metric are where an unowned flow belongs.

A miss answers `404` rather than `403`, like the sibling `GET
/api/transaction/:id`: a saga id is a `randomUUID`, so a distinguishable status
lets a caller confirm that a given checkout happened.

## Consequences

- **The `5xx` hole closes as a side effect.** A pre-pivot failure against a
  participant that is down now leaves an instance the sweep finishes or unwinds,
  where before it left one nothing touched. That is the largest behavioural
  change in this record and it was not what the issue was filed for.
- **`SagaInstance` carries the caller's `inputs`**, which for checkout means a
  cart. The `saga` store is control-plane, and it already held every
  participant's response bodies — including the written order — so this widens
  what is there rather than changing its class.
- **The engine's walk is a function two entry points share.** `runSaga` calls it
  from zero; `resumeSaga` calls it from a derived index with rebuilt state.
  Behaviour on the in-process path is unchanged, and its 141 existing assertions
  pass untouched.
- **An instance whose definition changed under it is stranded, loudly**, rather
  than resumed against steps that no longer match. Nothing runs in production and
  a definition edit ships with a reset, so this is a development-time guard for
  the case where a live lab has instances mid-flight.
- **Two sweeps now run in transaction-service**, on separate dials: the recovery
  sweep labels stuck single-step transaction records `STALE`, and this one
  finishes stuck multi-step flows. They share a store and nothing else.

## What this does not build

- **The command outbox and its HTTP relay** — struck, not deferred. If a future
  flow has a step whose result is *not* needed inline, that step is a message and
  belongs on the bus the fleet already has, which is ADR 0039's own asymmetry
  rather than a new mechanism.
- **A resumed flow does not answer anybody.** The buyer's HTTP response was lost
  with the coordinator that died. What the sweep restores is the *system's*
  consistency — holds released or converted, the order written or deleted — and
  the buyer learns the outcome from the order, not from the saga.
- **Backoff between resume attempts.** The sweep's interval is the backoff, and
  a second dial would be a retry policy for a mechanism whose ceiling is three.

The reopen condition ADR 0039 stated is untouched and stands: if the definition
grammar grows conditionals, timers or human tasks, we are writing a workflow
engine and should adopt one rather than finish this.

## Amends

- [ADR 0039](0039-multi-step-sagas-are-orchestrated.md) — its "the dispatch goes
  through the outbox" section is superseded by the decision above; the dispatch
  stays persisted-before-sent, and what changes is that the instance is the
  record rather than an entry beside it. Every other decision in that record
  stands: orchestration per flow, Richardson's classification, commands over
  HTTP and results over the bus, the semantic lock, the rejection of a durable
  execution engine on its stated reopen condition — and its consequence that a
  saga's state is queryable, which is now served rather than merely storable.
- [ADR 0052](0052-the-checkout-saga.md) — same, for its "the dispatch is an
  outbox entry whose relay speaks HTTP" section. Its four bullets about how that
  relay would differ from the AMQP one were the evidence that it was not an
  outbox: walking one database, writing back, and distinguishing a refusal from
  a failure are all things the engine does inline. Every other decision stands,
  including the one this record depends on entirely — that a participant the
  saga may retry must be idempotent on the command id.

[ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md),
[ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) and
[ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md) are
applied here, not changed.
