# 73. The optimistic contract settles by push, and catches up from flow-status

- Status: Accepted
- Date: 2026-11-02
- Revised: 2026-11-03 — built for the back office (#478). `TransactionSettlement`
  had already left with #499, so nothing ran ADR 0043's settlement in between.
  Every generated form with a save writes through `buildEntityRestAdapterWrite`,
  and the push topics are declared by each domain shell and subscribed once by
  the app.
- Area: frontend
- Read when: a write answers `202`, a screen shows a write before the server has it, or a failure has to reach the user — the server picks the mode, a pending flow is keyed by `flowId`, and a pending result never shows money taken
- Revised: 2026-11-04 — checkout, the till's sale and both cancellations answer `202`, and the saga runner the record named is deleted (#486, #487, #490)
- Revised: 2026-11-04 — a write whose flow parks past its commit point settles there (#489): a vendor's `dispatch` waited on a delivery flow that only ends with the courier's report, days later, which held the report's own verbs disabled until the report arrived. `flow.waiting` confirms it, and so does a catch-up reading `waiting` with `committed` (entifix 0.17.0, slip grammar 2)

## Context

[ADR 0043](0043-the-optimistic-mutation-contract.md) settled a `202` by
watching the single-step tracker: a `TransactionSink` announced the pending
write, the stream's `transaction.*` events settled it, and a reconnect re-read
`GET /api/transaction/:id` per pending id. Every part of that is going:

- the tracker and its by-id read left with the specification create (#463), and
  wave 4 deletes the saga runner whose record answered `GET /api/saga/:id`
  ([ADR 0066](0066-flows-run-on-a-durable-workflow-engine.md));
- the writes that will answer `202` are flows — checkout, cancellation,
  delivery and return — not creates, so ADR 0043's "the pending set can only
  ever hold creates" no longer describes anything;
- a failure reached the screen as a free-text `error` string, which ADR 0043
  filed as its first residual.

entifix 0.14.0 ships the replacement: one mutation API for both settle modes,
a pending-flow store, and a settlement hook driven by the push channel
([entifix ADR 0022](https://github.com/r10c-technologies/entifix/blob/v0.17.0/docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
This record says how r10c uses it.

## Decision

### The server picks the mode, and a screen never branches on a status

| The write                                                                     | Answers                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------- |
| a save, a delete or a verb that commits in one unit of work                   | `200` with the entity                       |
| a write that starts a flow across slices (checkout, cancel, delivery, return) | `202` with `flowAccepted { flowId, links }` |

A screen calls `useOptimisticMutation` with `apply` and `rollback` and reads one
status: `settled` for a write that happened, `pending`, `confirmed` or `failed`
for a flow. `makeEntityCrud` routes its saves, deletes and verbs through it, so a
generated screen gets both modes without knowing which one it is in.

### ⚠️ The money rule: a pending result never shows a captured state

`202` means the flow was accepted, not that a payment was captured or an order
placed. A pending checkout renders as pending — never as paid, never as a
receipt — until `flow.completed` arrives or flow-status says so. The status set
is deliberately coarse (`pending`/`confirmed`/`failed`) so a screen cannot
express a finer claim than the server made.

### Pending flows are keyed by `flowId` and persisted per principal

The pending-flow store holds `{ v, flows: [{ flowId, topic, createdAt, status?,
intent? }] }` — JSON only, an id and what the write meant, never an entity
instance ([ADR 0032](0032-what-may-live-in-an-autosaved-draft.md)). A stored
value at another `v` is discarded, not migrated.

- In the back office it is `PendingFlowsProvider` over IndexedDB, keyed by the
  workspace scope (`pending-flows:<scope>`), so one principal's flows never
  appear to another on the same browser.
- On the storefront the scope is anonymous: the store keeps flow ids and their
  age only, because an intent or a status link could carry personal data or a
  capability and nothing scopes an anonymous storage to one person.

### Settle by push, catch up from flow-status

- Each pending flow subscribes `flow:<flowId>` on the tab's one push channel
  ([ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)).
- `flow.completed` confirms; `flow.failed` rolls back and emits **exactly one**
  failure toast, however many times the event is redelivered.
- `flow.waiting` confirms too. The engine announces it only at a wait **past
  the commit point**, so the write the caller made has landed and what the flow
  waits on — a courier's report — is not the caller's to wait on. The money rule
  holds: a wait comes after the pivot, and the screen re-reads the record rather
  than claiming more than the server did. A catch-up confirms a `waiting` flow
  only when its status says `committed`.
- On connect and on `resync`, every pending flow is re-read from flow-status
  (`GET /api/realtime/flow/:id`).
- ⚠️ A `404` from flow-status means **not projected yet**, never failed — ADR
  0043's tracker rule, kept for the projection. The flow stays pending up to
  `PENDING_FLOW_MAX_AGE_MS` (30 minutes) and is then dropped with no toast: the
  record is the truth, and there is nothing true to tell the user.

### A failure is a code, toasted through the `errors` catalog

A failure arrives typed, with a permanent `code` that is its `errors` catalog
key ([ADR 0064](0064-failures-reach-the-slice-shell.md)). The toast region
renders it through `useErrorMessage`, and it stays until dismissed. This closes
ADR 0043's free-text residual: no screen shows a string a service threw.

### ⚠️ A pending create stays on its form

A create handed to a flow keeps its form mounted, in a pending state, until the
flow settles. It is not prepended to a list and not patched into the cache: ADR
0043 measured the list refetching on mount and the row vanishing, and that
finding stands. On failure the form keeps its input, so the user can correct
and resend rather than retype.

## Consequences

- **Built by #478** for the back office, and by #485/#486 for the storefront's
  and the till's checkout. `PendingTransactionsProvider`, ADR 0043's pending
  set, stays mounted beside it until entifix #127 removes it.
- The tab strip is still not wired to pending state: a flow is not a tab, and
  this record adds no address for one.
- A pending flow dropped at the age bound is not announced. The record is still
  on the server and the next read shows it.
- The pending-flow store is the second persisted shape beside the draft, under
  ADR 0032's rules.

## Supersedes and revises

- **Supersedes** [ADR 0043](0043-the-optimistic-mutation-contract.md). Its
  render-time-merge finding is kept, as the pending create staying on its form.
- **Revises in place** [ADR 0032](0032-what-may-live-in-an-autosaved-draft.md):
  pending flows are a second persisted shape, JSON-only and scoped per
  principal like the draft.
