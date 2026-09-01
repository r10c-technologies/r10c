# 29. The event envelope, and a bus that routes

- Status: Accepted
- Date: 2026-09-01
- Amended by: [ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) — a
  subscriber's queue is no longer unconditionally exclusive. A `work`
  subscription binds a named, durable queue with a dead-letter exchange and a
  delivery limit; `broadcast` keeps the exclusive queue described below. The
  envelope, the topic exchange, the routing key and the single deduplication key
  all stand.

## Context

The `{ meta, data }` split in `EntifixEnvelope` is already the right shape: `meta`
describes the message, `data` is the payload. What it does not carry is anything
a _bus_ message needs, and three consequences follow.

**The bus can only carry one kind of message.** `ports/event-bus.ts` typed
`publish` and `subscribe` on `TransactionEvent`. ADR 0009's catalog publication
has nothing to travel in, so #145 would have had to add a second framing and a
second transport for the same job — and #136's `EntityChangeEvent`
(`reactive-channel.ts`) a third.

**The register declares a routing vocabulary that does not exist.**
`tools/slices/*.slice.ts` carries `transaction.*`, `catalog.published`,
`order.placed`, `order.cancelled`, `payment.captured`, `payment.failed` and
`settlement.run.completed` as `publishedEvents`/`subscribedEvents`. The transport
was a **fanout** exchange published to with the routing key `''`, and
`TransactionEvent` had no field that could hold one of those names. `slices.spec.ts`
checked the three store invariants and never these. A documented contract with no
implementation and no enforcement.

Fanout also has a defect that only appears with a second publisher. Every
subscriber receives everything and discards what it does not want, in its own
handler — which puts the routing rule in the one place no register can check,
and would have had the marketplace projection folding transaction events to find
its own. It is the same fault #136 warns about for sockets, already live on the
bus.

**`meta.entity` means two things, and nothing reads it.** It was a required
`string`: the target class on HTTP, `event.entity` on the bus. Grepping the
repository, the only member ever read is `meta.type` — twice, both in
`read-envelope.ts`, both the discriminant check; `assertEnvelope` derives its
entity name from the constructor, not from the body. That is how it drifted into
carrying two meanings without anything breaking. It also has no honest value for
a message about a settlement _run_.

There is a fourth, smaller thing. `ARCHITECTURE.md` and `CLAUDE.md` both said
consumers "dedupe on `transactionId`". That is right for the saga tracker, which
_folds_; it is wrong as general guidance, because one transaction emits up to
three messages and a consumer keying on the transaction id would treat
`completed` as a redelivery of `accepted` and drop the outcome. The outbox's
unique index already knew better — it was on `{transactionId, step}`.

## Decision

### `meta` gains an event block, and `meta.entity` becomes optional

```ts
interface EntifixEventMeta {
  name: string; // `catalog.published` — also the routing key
  id: string; // unique per message; the deduplication key
  source: string; // the emitting slice
  at: string; // ISO-8601
  correlationId?: string; // ties one flow together
}
```

Both live in `entifix-ts-core` beside the envelope, because core already owns the
discriminant "so every artifact agrees on it". A `DomainEvent<TData>` is that
metadata plus its payload, and `makeEventEnvelope`/`readEventEnvelope` are the
bus's counterparts to the entity builders.

The dividing rule is worth stating because it settles every future field:
**`meta` describes the message, `data` describes the occurrence.** So
`correlationId` is metadata and an outcome's `code` is not.

`meta.type` stays the **envelope** discriminant and gains `event`. It is
deliberately not `transactionEvent`: once a message can be `catalog.published` as
easily as `transaction.completed`, naming the envelope after one publisher's flow
is wrong. `transactionEvent` survives on the HTTP surface, which frames a
transaction _record_ — see the residual at the end.

`meta.entity` is now optional and means only what it always meant on HTTP: the
entity class. What a message **is** lives in `meta.event.name`.

### `source` is the emitting slice

Not the deployment: co-deploying two slices into one process is reversible
(ADR 0021), and a `source` that changed when a process moved would rewrite
history for a fact that did not change. Not the domain either: a slice may hold
several. The slice is ADR 0020's ownership noun and is already executable in
`tools/slices/`, which is what lets the register be checked against the bus.

It is provided as `EventSourceTag` at each composition root, beside
`TenantDatabasePrefix` and `SagaDatabaseName`, so a service that forgets it fails
to build its layer rather than publishing events signed by nobody.

**`source` is for routing, observability and audit — never a consumer branch.** A
handler that behaves differently depending on who published re-couples the two
services the bus decoupled. This is the one idea worth keeping from .NET's
canonical `(sender, eventArgs)` handler signature, whose `sender` is typed as
bare `object` precisely so that depending on it is awkward. TypeScript cannot
reproduce that friction, so here it is a rule and a doc comment rather than a
type.

### One deduplication key, and it is not the correlation id

`event.id`. For a transaction step it is `` `${transactionId}:${step}` ``, which
is exactly what the outbox's unique index enforces — so the idempotency claim and
the dedup key are one value rather than two that can drift. `transactionId`
becomes `correlationId`, which is the question it actually answers.

`TransactionEvent` keeps its own `transactionId` and `at` as payload members even
though the metadata now carries both. The duplication is deliberate and standard
(CloudEvents' `subject` does the same): metadata is what the transport routes and
deduplicates on, and a payload has to stand on its own for a consumer that has
already unwrapped it.

### A topic exchange, and `subscribe` takes a pattern

`entifix.events`, type `topic`, published to with `event.name` as the routing key.
`EventBus.subscribe(pattern, handler)` binds the subscriber's exclusive queue to
the pattern it declared — the saga tracker binds `transaction.*`, which is the
same string `tools/slices/transaction.slice.ts` has always declared as
`subscribedEvents`. The register becomes executable at the transport rather than
prose about it.

A **new exchange name**, not a redeclaration: a broker will not change an existing
exchange's type, so `entifix.transactions` had to be left behind. It lingers,
unbound, in any dev broker that predates this; a `dev:reset` clears it.

### The register asserts a publisher exists, and nothing stronger

`slices.spec.ts` now checks that every `subscribedEvents` entry is declared in
some slice's `publishedEvents`, that no slice subscribes to its own, and that
every name matches the lowercase dotted grammar the routing key requires.

Planned slices count as publishers, because ADR 0022 records ownership before a
process exists: what must be on file is _who will publish it_, not that something
already does. Asserting that a declared event is actually **emitted** would fail
the build today — `marketplace-admin` declares `catalog.published` and nothing
emits it until #145 — so that check belongs to the commit that makes it true.

The pattern matcher is duplicated between `matchesEventPattern` in core and
`slices.spec.ts`, because `tools/` sits outside the workspace's package graph and
importing a library there would make the register check depend on a build. Same
shape as ADR 0024's `SalesChannelType` duplication: two small lists that must
agree, both spec-pinned.

## Consequences

- The stored shape of `transaction_outbox` changes — `{transactionId, step}`
  collapses into `eventId`, and `event` is a `DomainEvent`. The unique index
  moves with it. There is no migration (nothing runs in production), so this
  needs a `dev:reset` on every machine that already has the collection.
- HTTP envelopes are unchanged on the wire. This edits the envelope every
  response in the fleet uses, to fix a bus problem, so the entity arm had to stay
  byte-identical — only the _optionality_ of `meta.entity` moved.
- #145 and #146 have a message contract to use, and #136 has one to adopt instead
  of inventing a third.
- Delivery is still **at-least-once**. A consumer that must not fold twice
  deduplicates on `event.id`; the saga tracker's `upsertFromEvent` is idempotent
  and needs nothing.
- The in-memory bus double and the fake amqplib channel both route by pattern
  now. A double that fanned out to every subscriber would let a wrong binding
  pass every test the adapters have.

## Residual

`GET /api/transaction/:id` and the `202` accept body both frame a transaction
**record** under the `transactionEvent` discriminant. A record is not an event.
Unpicking it needs a new discriminant, which changes the browser's accept-shape
assertion in `build-entity-rest-adapter-save.ts` and the e2e mocks, so it is
tracked separately rather than folded in here — issue
[#176](https://github.com/r10c-technologies/r10c/issues/176).

## Amends

- [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
  — its decisions all stand (the client mints the id, the engine never publishes,
  the outbox lives in the tenant plane, `completed` is written by the handler,
  delivery is at-least-once). What changes is the deduplication key, which is now
  `event.id` rather than `transactionId`, and `OutboxEntry`'s shape.
