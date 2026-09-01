# 30. Failure, retry and quarantine on the bus

- Status: Accepted
- Date: 2026-09-01

## Context

ADR 0028 made an event durable and ADR 0029 made it routable. Neither says what
happens when a message cannot be processed, and the answer the code gives today
is: it disappears.

**A failed message is discarded, not dead-lettered.** `amqp-event-bus.ts` ends a
failed delivery with `nack(message, false, false)`, and the comment beside it
says "dead-letter on failure". Grepping `infra/`, `packages/` and `apps/` finds
**no dead-letter exchange anywhere**. Nothing catches the nack. The spec that
covers it is named `dead-letters a message whose handler failed` and asserts only
that a nack happened, which is why the gap survived review — the test agrees with
the comment, and both are describing an intention.

**A subscriber loses everything published while it is down.** The adapter takes
`assertQueue('', { exclusive: true })`. An exclusive queue dies with its
connection, so a message published while the consumer is restarting is routed to
zero queues and dropped by the broker — while the outbox has already recorded it
as `sent`. ADR 0028's durability chain therefore ends **at the exchange**, one
hop short of the consumer it exists to protect. The saga tracker survives this
because its fold is an upsert and the next event repairs the record. #146 does
not: marketplace-service restarting during a publish loses a `catalog.published`
permanently, and the projection is silently short one offering with nothing in
the system able to notice. That is an M1 defect, already designed in.

**There is no tier between "the handler threw" and "gone".** No retry, no
attempt count, no delay. One failure is terminal.

**The publisher side has the same hole, in the opposite direction.**
`drainOutbox` stops at the first failure — correct, it keeps `accepted` ahead of
the terminal event — and the sweep wraps everything in
`Effect.catchAll(() => Effect.void)`. An entry that can never publish therefore
blocks that tenant's outbox head-of-line **forever**, with no attempt count, no
ceiling and no surface. Nothing in the repository names this case.

**And the rule that makes at-least-once safe is unenforced.** `relay.ts` states
it plainly — "a consumer that is not idempotent may not subscribe to this bus" —
and it is true today only because both consumers happen to be upserts. A stock
decrement or a payment capture cannot be naturally idempotent, and #150/#152 are
already on the milestone list.

## Decision

### Three failure classes, and they must not be conflated

- **Transient** — a broker blip, a handler timeout, a dependency briefly gone.
  Retry it.
- **Poison** — `readEventEnvelope` rejects the payload, or the schema is unknown.
  Quarantine it **immediately**, without a single retry. A message that cannot be
  deserialized will not become deserializable; retrying only spends the attempt
  budget of the messages behind it. This is the one rule every mature bus library
  converges on, and it is the opposite of what our adapter does today, which
  treats a malformed payload exactly like a failed handler.
- **Business failure** — the transaction rolled back. **Not a bus concern at
  all.** That message was processed successfully and already produced a `failed`
  event. Conflating it with the first two is how a compensating flow turns into
  an infinite redelivery.

### A subscription is durable and named, and it declares a mode

`subscribe` stops taking a bare pattern and takes a subscription:
`{ pattern, queue, mode, maxAttempts, onPoison, dedupe }`.

- **`mode: 'work'`** — a durable **quorum** queue, named from the subscribing
  slice and its pattern, which survives the consumer's restart and accumulates
  while it is gone. Two replicas share it, so each message reaches exactly one of
  them.
- **`mode: 'broadcast'`** — the exclusive, connection-scoped queue ADR 0029
  built, unchanged.

ADR 0029 chose exclusive for a stated reason worth answering rather than
skipping: a shared queue delivers each event to one replica, "which reads as
flakiness rather than as a design". That reasoning is right for a **broadcast**
consumer and wrong for a **work** consumer. #136's socket push is broadcast —
every replica holds different sockets, so every replica must receive. A
projection writer, the saga tracker's fold and a settlement consumer are work,
and exactly-one-replica is precisely what they want. 0029 did not pick the wrong
queue; it picked broadcast semantics for a workload that is work, at a time when
the only subscriber made the difference invisible.

Naming the queue is what makes durability possible at all — an unnamed queue is
regenerated on every reconnect and cannot accumulate anything.

### One dead-letter exchange, and quarantine is per queue

`entifix.events.dlx`, type **direct**. Every work queue is declared with
`x-dead-letter-exchange: entifix.events.dlx` and
`x-dead-letter-routing-key: <queue>`, and a durable `<queue>.quarantine` binds
that key.

Per queue rather than one shared quarantine, because a replay from a mixed
quarantine redelivers other subscribers' messages — a recovery step that causes a
second incident. RabbitMQ preserves the original routing key and appends an
`x-death` header, so a quarantined message carries both what it was and why it
stopped, which is what makes a deliberate replay possible at all.

### Retry belongs to the broker, and there is no delayed tier yet

Work queues are declared with `x-delivery-limit: maxAttempts`. The broker counts
deliveries and dead-letters at the limit, so the retry policy is a queue argument
rather than logic every consumer reimplements. The adapter's nack splits
accordingly: `requeue: true` for a transient handler failure, `requeue: false`
for a poison message.

Quorum queues and `x-delivery-limit` exist on the 3.13 broker the lab runs, so
none of this waits on a version bump. RabbitMQ 4.3's separation of
`acquired-count` from `delivery-count` makes the counter more accurate — a return
that is not a genuine failure stops pushing a message toward the limit — but it
enables nothing here. The upgrade is recommended and backlogged (#181), not a
prerequisite.

**Delayed redelivery is rejected for now**, and the trigger for revisiting it is
named: the first consumer whose failures are dominated by a flaky upstream rather
than by its own bugs. Delay on RabbitMQ needs either the delayed-message plugin
or TTL-and-bounce queues, and neither is worth carrying to soften five immediate
attempts under `prefetch(1)`.

### Consumer idempotency becomes a declaration, and the inbox is its mechanism

A `TransactionInbox` port, symmetric to `TransactionOutbox`: it claims `event.id`
in the **same storage transaction** as the side effect, so a redelivery finds the
claim taken and does nothing. The key is `event.id` and never `correlationId` —
one transaction emits up to three messages, so keying on the correlation id would
make `completed` look like a redelivery of `accepted`, which is the mistake
ADR 0029 already corrected once in prose.

The claim needs the handler's own session, exactly as the `completed` outbox
entry does, so the port stays framework-free and the adapter lives in the
service.

A subscription declares `dedupe: 'inbox' | 'natural'`, and `'natural'` requires a
stated reason on the declaration. The tracker's fold and the projection's upsert
are genuinely natural; saying so out loud is what stops the next consumer
inheriting an assumption nobody re-checked.

### The outbox relay gets an attempt count, a ceiling and a quarantine

`OutboxEntry` gains `attempts` and `lastError`. Past the ceiling an entry is
marked quarantined and **skipped**, so the head of the line moves. The publisher
side and the consumer side then have the same three outcomes — delivered,
retrying, quarantined — rather than one having a vocabulary and the other having
an infinite loop.

### Graceful shutdown is part of message handling

On SIGTERM: readiness flips to `degraded` so kubelet removes the pod from the
load balancer, a `preStop` grace period lets that propagate, consumers are
cancelled, in-flight handlers finish under a bound, the relay drains once more,
and only then are the connections closed. Liveness keeps answering `live`
throughout — the process is healthy, it is leaving.

This is not deployment trivia. Without it every rollout redelivers whatever was
unacked, which is safe only under the assumption the inbox decision above stops
making.

### A transaction's definition of done includes its failure treatment

`SliceDeclaration.subscribedEvents: readonly string[]` becomes
`subscriptions: readonly SubscriptionDeclaration[]`, and `@r10c/slices` fails the
build on a subscription that declares no policy. The register already made store
ownership executable; this makes delivery policy executable in the same way, so
"how does this fail" is answered where it can be checked rather than in a review
comment.

That change ships in the commit that builds the adapter (#177), never earlier.
Declared configuration that no code reads is the same defect as a store nothing
writes — ADR 0020 struck `marketplace_admin` from the register for exactly that,
and a `maxAttempts: 5` nothing enforces would be the same lie in a smaller font.

## Consequences

- A `dev:reset` is required, though not for the reason first written here. The
  queue topology needs none: the work queues are **new names**, and the
  anonymous exclusive queues they replace auto-delete with their connection. What
  does need it is the outbox's partial index — `{ createdAt: 1 }` gains
  `quarantined: false` in its `partialFilterExpression`, and Mongo rejects a
  re-declaration of the same key pattern with different options
  (`IndexOptionsConflict`). `ensureOutboxIndexes` runs on every sweep and every
  create, so a database that predates the change fails on every pass. Nothing
  runs in production and there is no migration.
- **`x-delivery-limit` is immutable once a queue exists.** Re-declaring a quorum
  queue with a different `maxAttempts` fails `PRECONDITION_FAILED` and closes the
  channel, and the connector would retry straight back into it. So a
  subscription's ceiling is a literal beside its register declaration rather than
  a config-service value: a tunable nothing can adopt is worse than a constant.
  The outbox relay's ceiling _is_ configuration, because it is re-read on every
  sweep and nothing in the broker pins it.
- #146 can be built. Until #177 lands, a projection consumer would be built on a
  queue that loses messages across its own restart.
- #135 stops having to invent dead-lettering. What remains there is retry with
  backoff, compensation on exhaustion, and moving the sweep's constants into
  config.
- #105 inherits a failure vocabulary. Its compensation question stays a domain
  question, because a business failure is explicitly not something the transport
  retries.
- Two consumers today are naturally idempotent, so the inbox is not urgent — but
  the declaration is, because it is what stops the third consumer from silently
  inheriting the assumption.
- A quarantined message and a quarantined outbox entry are both countable, which
  is what #186 measures and the only reason "quarantined, not dropped" differs
  from "dropped" in practice.

## Trigger

Promoted to Accepted by #177 (durable work queues, the dead-letter exchange and
the bounded retry), which is the commit that also lands the register's
subscription declaration and #179 (the relay's ceiling). #178 (the inbox) and
#180 (graceful shutdown) complete it.

Two things that commit deliberately did **not** land, because the code that
would read them does not exist yet — the same rule this record applies to the
register. `SubscriptionDeclaration` carries `{ event, mode, maxAttempts }` and
**no `dedupe`**: the strategy and its required reason arrive with #178, which is
what enforces them. And `Subscription` carries no `onPoison`, because the
decision above gives a poison message exactly one treatment; a field with one
legal value describes nothing.

## Amends

- [ADR 0029](0029-the-event-envelope-and-a-routed-bus.md) — its envelope, its
  topic exchange, its routing key and its single deduplication key all stand.
  What changes is the subscription topology: a subscriber's queue is no longer
  unconditionally exclusive, it is named and durable when the subscription is
  work, and it carries a dead-letter exchange.
- [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
  — delivery is still at-least-once and the outbox is still the durable hand-off.
  What changes is that at-least-once acquires a ceiling: `OutboxEntry` gains
  `attempts`, and an entry that exhausts them is quarantined rather than retried
  forever.
