# 66. Flows run on a durable workflow engine, and the saga runner, the tracker and the single-step engine go

- Status: Accepted
- Date: 2026-10-28
- Area: messaging
- Read when: a flow spans slices, has to survive its coordinator dying, or answers `202` — flows run on Effect Workflow over Postgres, and the saga runner and tracker are deleted, not kept beside it

## Context

Checkout and cancellation run on entifix's own saga runner: `defineSaga`
definitions in `packages/shells/effect/transaction/src/sagas/`, an HTTP
dispatcher, a `saga` store whose instance is the durable record
([ADR 0055](0055-a-coordinator-resumes-from-its-own-record.md)), and a resume
sweep that picks up a flow whose coordinator died. Single-step writes run on a
second engine — the transaction tracker, a Redis lock and sequence, and
`TransactionRecord` read back through `GET /api/transaction/:id`
([ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).

Two engines, each with its own durability story, and neither has the three
things the commerce model needs: a durable **wait** (a cash-on-delivery order
waits days for a courier), a **child flow** (a refused delivery refunds through
a flow of its own) and a **join** across vendor segments. Nothing isolates a
failing participant either: the runner retries after the pivot in a loop.

[entifix ADR 0016](https://github.com/r10c-technologies/entifix/blob/v0.11.0/docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)
gives a `FlowEngineTag` port and a durable adapter over `effect/workflow`;
[ADR 0065](0065-use-case-resolution-and-the-routing-slip.md) gives the pinned
slip it interprets.

## Decision

### One engine: Effect Workflow on Postgres, from day one

Flows run on `ClusterWorkflowEngine` with SQL runner and message storage on
Postgres, interpreting the pinned slip through one generic interpreter. The
commit point is a property of the slip (a pivot, or `flow.commit@1`), so
"compensate before it, suspend after it" is by construction rather than by
review. Waits, child flows and joins are the engine's. Every `slipVersion` has
a recorded journal that replays to the same command sequence, and the chaos
suite gates every `effect` bump.

### The `workflow` store

A new store `workflow` — control plane, owner `transaction`, Postgres. It holds
the engine's journal and an outbox for `flow.*` events, written by an
idempotent `announce` Activity and relayed like any other domain event.

### Runners

A runner's port is its service's port + 31000 + 1000 × replica: `34103` and
`35103` for transaction-service. The lab runs two runner processes, and only
replica 0 binds HTTP. In-cluster replicas are ≥ 2 once service manifests land.

### A start answers `202`, and nothing waits for the flow

Checkout and cancellation move together onto the engine. A start answers
`202 { flowId, links }`; the caller settles by push from `flow.*` events, never
by holding a request open. There is no synchronous await anywhere.

### What is deleted, and nothing is kept beside it

`runSaga`, `defineSaga`, the resume sweep, store `saga`, the tracker and
`TransactionRecord`, the `transaction.*` events,
`GET /api/transaction/:id|events`, `GET /api/saga/:id`, the single-step engine
with its Redis lock and sequence, store `saga-coordination` and
`packages/implementation/saga/mongo`. `saga-contracts` becomes `flow-contracts`
(`FlowStarterTag`), and `postSaga` becomes `postFlow`. A specification's code is
drawn from a Mongo `$inc` counter rather than the Redis sequence.

## Consequences

- One durability story: a flow is its journal, and the record ADR 0055 resumed
  from is gone with the runner.
- The engine is `@stability unstable`; containment in `@entifix/workflow`, the
  chaos suite and journal replay are what make that acceptable.
- **Supersedes** [ADR 0039](0039-multi-step-sagas-are-orchestrated.md),
  [ADR 0052](0052-the-checkout-saga.md) and
  [ADR 0055](0055-a-coordinator-resumes-from-its-own-record.md), and the tracker
  sections of [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md).
- **Revises in place** [ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)
  (the pivot is the slip's commit point), [ADR 0058](0058-the-order-after-payment.md)
  §7 (cancellation is a composed slip), [ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md)
  (transaction-service runs two runners), [ADR 0047](0047-authoring-an-offering-and-the-publish-verb.md)
  (a specification create answers `200`) and [ADR 0001](0001-observability-and-tooling.md)
  (breaker metrics and a panel, per [ADR 0067](0067-a-breaker-and-bulkhead-per-participant.md)).
- The build is wave 3 and 4 (#462, #486, #487, #490); until then the saga runner
  keeps running, unchanged.
