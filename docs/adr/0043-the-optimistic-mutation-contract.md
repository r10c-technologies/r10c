# 43. The optimistic mutation contract, and reconciliation is a re-query

- Status: Accepted
- Date: 2026-09-06
- Area: frontend
- Read when: a write answers `202` — the browser keeps watching, and a `404` from the tracker means not-tracked-yet, never failed
- Amends: [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
  (the client-minted id becomes something the browser keeps, not only something
  it sends; every decision there stands).
- Amends: [ADR 0036](0036-the-reactive-stream-is-server-sent-and-same-origin.md)
  (its "the client re-queries its pending transaction ids and reconciles" is
  built here, and `ReactiveChannel` gains the connect signal that makes it
  possible).

## Context

A transactional create is asynchronous and nothing downstream of the adapter
knows it. `buildEntityRestAdapterSave` mints the transaction id, POSTs a command
envelope, validates the `202` for shape, **discards** it, and returns the entity
it already held. That return is indistinguishable from a plain REST create, so
every caller treats a write that has not happened yet as a write that has.

**Creating a record navigates away from it before it exists.**
`make-entity-crud.tsx:270` is `if (await save(next)) { draft?.clear(); afterSave(); }`,
and for a command create `save` resolves at the `202`. `afterSave` defaults to
`router.push(basePath)`. So the form leaves for the list while the write is still
in flight, the list does not contain the record yet, and if the transaction fails
there is no row, no message and nothing to retry from — the operator retypes from
memory and nothing anywhere recorded that a save was lost.

⚠️ **And on the create path there is no draft to lose in the first place.** A
create is `/catalog/<entity>/new` on the plain route, rendering
`SingleViewPage` with **no props** — `slug`, `draft` and `onSaved` all
`undefined`, `slugToEntityId` mapping the `new` slug to no id. The workspace's
registry has exactly two arms, `master:<key>` (the list) and `master:<key>:<id>`
(`EntityEditorTab`, which takes a **required** id), so a create is not a tab and
has never had autosave. `draft?.clear()` on that path is a no-op on a draft that
was never taken. The input is lost by navigation, not by clearing.

**A create's row does not appear until something else invalidates.**
`SingleViewPage` never touches the query client. The only invalidation in the
whole generated CRUD is the bulk-action one at `:189-191`. So a new record
surfaces when an unrelated SSE frame happens to arrive, which reads as latency
rather than as the missing write it is.

**`TabState`'s `'saving'` and `'error'` are styled and never produced.** The
union is declared at `tab-strip.tsx:31` and rendered at `:66`; the only writer is
`workspace-shell.tsx:220`, `state={tab.param in drafts ? 'dirty' : 'idle'}`.

**And the documentation asserts the opposite of all of it.**
`docs/FRONTEND.md:594` states that mutations "are optimistic: `onMutate` patches
the cache from the Zustand draft and snapshots for rollback, `onError` rolls
back, `onSettled` invalidates". None of that exists: `useEntityMutation` is
`useReducer` + `Effect.runPromise`, imports no TanStack, and holds no
`QueryClient`. The claim was design intent that never became code, and it sits a
few lines from the section a reader would check first.

What _does_ exist is everything underneath. ADR 0028 made the transaction id the
client's, and it is also the entity's id. ADR 0036 shipped the stream, scoped per
connection, and left one sentence for this record: "on reconnect the client
re-queries its pending transaction ids and reconciles — #137's work".

## Decision

### The browser learns from the adapter, through a sink

The save adapter is the only place that knows a save was transactional, so it
says so — into a `TransactionSink` port read with `Effect.serviceOption`.

`serviceOption` rather than a required tag, and that is what makes it cheap: the
tag never enters the adapter's `R`, so the storefront, the plain REST adapters
and every existing spec compile and run unchanged with no layer to provide.

⚠️ That erasure is also the risk, and it is closed by a test rather than by the
type system. Because the tag is absent from `R`, **nothing forces `mergeContext`
to provide it**; forget to, and `serviceOption` returns `None`, everything
compiles, the adapter's own spec reaches 100% on both arms, and the feature is
silently dead. A spec therefore asserts that the context `mergeContext` builds
contains `TransactionSinkTag` — the same shape of guard `@r10c/slices` uses for
a `@useCase()` class that is unreachable from its barrel, and for the same
reason: an invariant the compiler cannot hold is one a test must.

The alternative was a second declaration — `transactional: true` in the crud
options beside `create: 'command'` in the adapter options — and it is rejected
for the reason this repo rejects every second truth: the two can disagree, it is
one more site per entity forever, and the one that decides behaviour is not the
one a reader is looking at.

**Announce after the shape assertion, never before.** A `2xx` that is not a
transaction envelope must not register a pending id, because nothing will ever
settle it and the entry becomes a permanent phantom.

### The pending set is session-scoped, not workspace-scoped

This is the decision the shape of the code forces, and getting it wrong makes the
feature fire never.

Tabs and drafts are workspace state, so their stores are scoped and rehydrated by
`WorkspaceShell`. A pending write is **not** workspace state: a create happens on
the plain route, outside any `WorkspaceShell`, and a generated list still uses
plain `href`s (ADR 0042's own residual), so the operator leaves the workspace to
make one. A pending store mounted inside the workspace would therefore be written
to by nothing, or — worse — written to _before_ `persist.setOptions` had ever
scoped it, which is the unscoped cross-account restore ADR 0032 exists to
prevent.

So the store is provided at the **`(authenticated)` layout**, above both the
workspace and the plain catalog routes, scoped with the same server-resolved
`workspaceScope()` the workspace already uses. The sink reaches the adapter
through a React context with a `Noop` default — the `EntityNavContext` shape,
which already solves "this capability exists only where a provider is mounted" in
this exact directory.

### The frame is a hint; the record is the reason

The SSE frame is an `EntityChangeEvent`, and the hub's `changeFor` collapses four
states into `created` / `deleted`. It carries no `error`. So a failure's reason is
**re-read** from `GET /api/transaction/:id` rather than widened onto the frame.

This is ADR 0036's own split — "the stream is a hint that something changed; the
record is the truth, and re-reading it is cheap" — applied one consumer later.
Widening the payload would duplicate onto `data` what already lives on `meta`,
which is exactly what that record declined to do for the correlation id.

What the frame _does_ carry is enough to route. Note the shape: a parsed
`DomainEvent<T>` is **flat** — `EntifixEventMeta` is extended, not nested — so a
listener reads `event.name` (`transaction.accepted|completed|failed`) and
`event.correlationId` (the transaction id) directly. `meta.` is how it appears on
the wire, not how it appears to a consumer.

### ⚠️ A `404` means _not tracked yet_, not _failed_

This is the rule most likely to be got wrong, and getting it wrong is invisible.

`accepted` reaches the tracker over the bus. With the broker down, the entity
write still commits — the outbox is in the same Mongo transaction (ADR 0028) —
but no event is ever published, so the tracker holds **no record at all** and
`GET /api/transaction/:id` answers `404`. That is a write in perfect health.

Only `FAILED` and `STALE` roll back. `404` and `PENDING` keep the entry pending.
Treating a `404` as a failure un-renders a record that is about to appear, and
does it precisely during a broker outage — the moment an operator is least able
to tell a UI bug from an infrastructure one. The reader therefore maps `404` to
`undefined` rather than to a failure, which is the one place in the HTTP path
where a `404` is not an error.

### ⚠️ `onConnect` fires on registration if the stream is already open

`ReactiveChannel` gains `onConnect(listener): () => void`, driven by
`EventSource.onopen` — **and it invokes a newly registered listener immediately
when the connection is already open.**

The replay is not a nicety, it is the whole mechanism. The channel is refcounted
and opened by its _first_ subscriber, and `useReactiveInvalidation` already
subscribes at the top of `WorkspaceView`. A settlement hook mounting after that —
which depends only on component-tree ordering — would register for an `onopen`
that had already fired and then reconcile nothing until the next real network
drop. On a page load with no disconnect, the persisted pending set from the
previous session would never be reconciled at all, which is precisely the case
this signal exists for. Replay removes the dependency on mount order instead of
relying on two hooks happening to live in the right places.

Required on the interface, not optional. An optional member on a port is how one
implementation quietly stops honouring it while every consumer keeps compiling.

### The pending set persists; the payload does not

Entries live in a zustand store persisted to the `r10c-workspace` IndexedDB
beside tabs and drafts, scoped `pending:<userId>:<organizationId>` and versioned,
under every rule ADR 0032 fixed for drafts — including that the scope is applied
with `persist.setOptions` **before** rehydrating.

Only `{ transactionId, entity, at }` survives. Not the entity payload, so **no
optimistic row is re-inserted after a refresh**: rebuilding a `TEntity` needs its
constructor, and a row fabricated from a persisted blob is a claim about server
state that nothing verified. The refresh path is instead reconcile-at-once plus,
on a terminal failure, a notice naming the entity.

An optimistic row exists to cover the seconds between the `202` and `completed`.
Past a refresh that window is over: server truth plus an explicit "this one
failed" is more honest than a synthetic row, and strictly more useful than the
current silence.

### ⚠️ The optimistic row is merged at render time, never patched into the cache

Patching the TanStack cache is the obvious move and it does not work. Measured,
in a browser: the list **refetches on mount** — which is precisely when the
operator arrives, having just been navigated there by `afterSave()` — and the
server legitimately does not hold the record yet, because that is what "pending"
means. The refetch replaces the patched page and the row disappears a moment
after appearing, which is worse than never having shown it.

So the pending set holds the record and the generated list prepends its entries
to `items`. The pending set outlives every refetch, so the row stays until the
write actually settles, at which point the entry is dropped and the server's own
copy takes its place.

Two consequences of holding a record rather than a cache page. It is
**in-memory only** — `partialize` strips it before persisting, because a class
instance does not survive a JSON round trip (ADR 0032), so a refresh keeps the
watch and loses the row, exactly as the persistence decision above describes. And
**`attach` returns whether the write was being watched**, which is how a caller
tells a transactional create from a plain one: asking `entries.some(...)` first
reads a React closure captured _before_ the caller's own `await`, so the
announcement the save adapter made during that await is invisible and every
transactional write reads as a plain one. One call, answered from current state,
has no such race.

A failed entry contributes no row: the write did not happen, and the notice
beside the table is what says so.

### `STALE` is reachable only by asking

The recovery sweep writes `STALE` and emits no event (`event.ts:22-24`), so it
can never arrive on the stream. It is found by the same re-query, on an interval
that runs only while something is pending — no pending set, no polling.

### N reads, not a batch endpoint

Reconciliation issues one `GET /api/transaction/:id` per pending id with bounded
concurrency. A batch route would need a new endpoint, a `TransactionStore` method
taking an id set, a register entry and a second response shape — against a
pending set that is a handful of records by construction and is capped.

**Reopen condition:** a pending set that routinely reaches its cap. That is
measurable rather than a matter of taste.

### The visible state is a notice, and the tab strip is deliberately not wired

⚠️ **`TabState`'s two unwritten values stay unwritten, on purpose.** The pending
set can only ever hold creates — `create: 'command'` fires only on
`isCreate && create === 'command'`, so updates and deletes take the synchronous
REST path — and a create has no tab, because `EntityEditorTab` requires an id and
the registry has no arm without one. A tab badge keyed on a pending record id is
therefore **unreachable by construction**, and wiring it would ship the exact
defect this record's Context names one layer up: a state that is declared,
styled, wired, and can never appear.

The pending state renders as a **notice above the list** instead — which is where
`afterSave()` puts the operator — reusing `TabState`'s vocabulary as the issue
asks, without inventing a second one. The tab strip is wired in the commit that
makes a create addressable, not before.

## Consequences

- **`docs/FRONTEND.md`'s optimistic-mutation paragraph is corrected in place**,
  not deleted: the shape it described is close to what lands, but it attributed to
  TanStack's `onMutate`/`onError` a reconciliation that is ours, out-of-band, and
  settled by an event rather than by a promise.
- **The `(authenticated)` layout gains a provider**, so a create on a plain
  catalog route is covered. Outside it the sink is a `Noop` and behaviour is
  exactly what it is today — an honest scope boundary rather than an unscoped
  write.
- **`mergeContext` widens.** `CrudContext` gains `TransactionSinkTag`, and a spec
  pins that it is actually provided.
- **The status reader must not use `readTransactionEventEnvelope`.** That function
  is typed `Effect<TransactionEvent, …>` while the route frames a
  `TransactionRecord` under the same `transactionEvent` discriminant — a wart the
  code already admits at `event.ts:165-173`. `readEnvelope` checks the discriminant
  and casts the payload, so the call succeeds while typing a record as an event: no
  `step`, no `at`, and a `state` the caller then branches on. A sibling
  `readTransactionRecordEnvelope` fixes the reader's half; the `202` accept-shape
  assertion keeps the existing function unchanged.

  > **Corrected 2026-09-09 by #176.** The wart is gone and so is
  > `readTransactionEventEnvelope`. The `202` carries `transactionAccepted` and
  > the by-id route carries `transactionRecord`, read by
  > `readTransactionAcceptedEnvelope` and `readTransactionRecordEnvelope` — and
  > the accept-shape assertion this bullet left alone was the reason it mattered,
  > since it had been passing on all three shapes.
- **`GET /api/transaction/:id`'s `404` body is corrected** from
  `{ message: 'transaction not found' }` to the fleet's `{ error, code }`. It was
  the only route answering a shape no envelope reader or `useErrorMessage` path
  understands.
- **The port change is small by measurement**, not by hope: `NoopReactiveChannel`
  and `ReactiveChannelTag` have no production call sites at all, and
  `makeInMemoryReactiveChannel` is spec-only. Three implementations, two specs —
  which must move in one commit, because a required member added to a port breaks
  every implementer at once.
- **Nothing in `tools/slices/` changes.** No new route, no new event, no new
  subscription — the register is untouched, which is the check that this added a
  client contract and not a wiring one.

## Alternatives considered

- **Widen `EntityRepository.save`'s return type** to report the transaction.
  Honest, and it removes the sink entirely. Rejected: the port is implemented by
  the Mongo and SQL adapters too, neither of which has a transaction to report, so
  the cost is a shape every backend carries for one frontend's benefit.
- **A `transactional: true` option on the crud**, with `handleSave` calling the
  sink itself and no Effect involvement at all. Genuinely smaller, and it needs no
  `serviceOption`. Rejected because it restates `create: 'command'` at a second
  site, once per entity, forever — and the disagreement is silent in the direction
  that matters, since declared-and-not-wired means a pending id nothing registers.
  The objection it answers (nothing forces the tag to be provided) is answered
  instead by pinning `mergeContext` with a spec.
- **Patch the cache with a snapshot and restore it on failure**, TanStack's usual
  optimistic shape. Rejected because the server is the truth here: settling with
  `invalidateQueries` refetches, which is both simpler and correct for a failure
  whose outcome arrives out of band, minutes later, possibly in another tab.
- **Answer `Last-Event-ID` from the outbox** so the stream replays what was missed
  and no re-query is needed. Rejected by ADR 0036 already, and this record does not
  reopen it: it would make the stream a per-connection backlog with a retention
  policy and a second durability contract beside the outbox's.
- **Prefetch or persist the optimistic row's payload** so a refresh can re-render
  it. Rejected: it is a claim about server state that outlives the session which
  produced it, and it puts entity data in a client store whose scoping is a
  convenience rather than a confidentiality boundary (ADR 0032).
- **Poll `GET /api/transaction/:id` on a timer and skip the stream.** Would work
  and needs no port change. Rejected because it is a poll per pending record per
  interval against a store whose read path exists for exactly one lookup, and the
  stream is already there.

## Residuals

- **A failed transaction's only reason is a free-text `error` string**, which is
  not i18n-able — it is whatever threw, in whatever language that code was written
  in. The notice's headline is therefore a catalog key and the string is secondary,
  explicitly-unlocalized diagnostic detail. The fix is an error **code** on the
  failure event, filed as a follow-up.
- **The tab strip is not wired**, and cannot be until a create is addressable. That
  needs `master:<key>:new`, or re-addressing the tab to `master:<key>:<id>` once
  the `202` mints the id — ADR 0028 makes that id final immediately, so the second
  is available, but `useTabsState` has `open`/`close`/`activate` and no rename.
- **A create still has no autosaved draft.** This record makes a failed create
  _visible_; it does not make it _recoverable_, because the create path was never
  given the `draft` port. Giving it one is the same commit that makes a create a
  tab, since the draft key is the tab address.
- **Only creates are transactional.** When an update command lands, `changeFor`
  must key off `command.type` rather than the state, as its own comment already
  warns.
- **An evicted pending entry is dropped silently** at the cap. The record is still
  on the server and the list's own query is the fallback, but the operator is not
  told that a specific write stopped being watched.
- **The interval re-query is the only path to `STALE`**, so a transaction that goes
  stale while no browser is open is surfaced to nobody until someone opens the list
  again. That is the tracker's existing property, not one this adds.
