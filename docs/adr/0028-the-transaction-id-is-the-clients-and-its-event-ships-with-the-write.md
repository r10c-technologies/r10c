# 28. The transaction id is the client's, and its event ships with the write

- Status: Accepted
- Date: 2026-09-01
- Amended by: [ADR 0029](0029-the-event-envelope-and-a-routed-bus.md) — the
  deduplication key is the message's own `event.id` (`<transactionId>:<step>`),
  not `transactionId`, and `OutboxEntry` carries a `DomainEvent`. Every decision
  in this record stands.

## Context

Three defects sit in one seam, and each of the first two is the reason the third
could not be fixed alone.

**The write and its event were two operations.** `run-transaction.ts`'s
`completeTransaction` committed Mongo through `executeUCFactory()` and then
called `bus.publish(completedEvent(...))`. With the broker unreachable between
them the state change had happened and the event never did: the saga record
stayed `PENDING`, and 60 seconds later `saga/tracking.ts`'s sweep flagged it
`STALE`. A client polling `/api/transaction/:id` was told a successful write had
failed. This is the **dual-write problem**, and the failure arm had the same
shape — rollback, then publish.

**The service generated the transaction id.** `routes/entity-crud.ts` called
`randomUUID()` per request. Yet `catalog-transaction-handler.ts` already did
`entity.id = command.transactionId`: the transaction id _is_ the entity id. The
one thing the client could not know was the identity of the thing it had just
created.

**So creating a record reported an error in the browser while succeeding on the
server.** The service answers `202` with a `transactionEvent` envelope; the REST
save adapter called `readEntityEnvelope`, which asserts `meta.type === 'entity'`.
`fetch-client.ts` treats `202` as `ok`, so this surfaced as an
`EntifixBuildError` rather than an HTTP failure — and the write still landed
asynchronously. No test could see it: the service-side spec checked the `202`,
and no browser-side spec ever exercised a create. It was not reported as a bug
because it looks like a validation error on a screen that then, eventually, shows
the record.

The blocking constraint was infrastructural. Local Mongo ran standalone
(`replicas: 1`, no `--replSet`), and multi-document transactions do not exist
there — `session.startTransaction()` fails outright. "The event lands in the same
write as the state change" was not implementable at all.

## Decision

### The client mints the transaction id, and it is the idempotency key

A `POST` to a transactional route now carries a `command` envelope whose
`transactionId` the client generated. There is no server-side fallback: a
command without a valid id is `400`. Per the repository's no-back-compat rule a
hard cut is available, and a fallback is worse than absent — a caller who omits
the id silently loses retry safety while appearing to succeed.

The id is untrusted input that becomes a primary key, so the key space it may
address is fixed: `isTransactionId` accepts a canonical RFC 9562 UUID and
nothing else. Every version is allowed, so v4 (`crypto.randomUUID`) and v7
(time-ordered) are both usable without the wire format becoming a second
decision.

**A repeated id is a retry, not a conflict.** It is answered `202` with the same
status link, and nothing executes twice. A `409` was rejected deliberately: the
correct client behaviour after an ambiguous failure is to resend, and answering
that with a conflict makes the safe action look like an error.

### The event is written in the same transaction as the state change

`execute` opens one Mongo transaction and writes both the entity document and a
`completed` **outbox** entry. A relay carries outbox entries to RabbitMQ
afterwards. The event can no longer be lost, because it was never in flight
separately from the write that justified it.

Three placements follow, and only the first is obvious:

- `accepted` and `failed` are written by the **engine**, through the
  `TransactionOutbox` port. Neither has a state change to be atomic with —
  `accepted` precedes the write, and `failed` follows a completed rollback.
- `completed` is written by the **handler**, inside its own session. Only the
  handler holds one, and a session may not enter `EntityRepository` or
  `TransactionOutbox`: both are framework-free contracts, and putting a Mongo
  type in either would make every future adapter carry a driver it does not use.
  So the engine's success path records nothing at all, which a spec asserts.
- The outbox collection lives in the **tenant database**, beside the entity. Two
  reasons, and the second only bites later: same database keeps the transaction
  single-database, therefore single-shard if this is ever sharded; and an outbox
  holds event payloads, so a control-plane outbox would move a whole offering
  into the control plane the day `catalog.published` rides it.

Delivery is **at-least-once**. A crash between publishing and marking an entry
sent redelivers it. That is acceptable only because the saga tracker's
`upsertFromEvent` is an idempotent upsert keyed on `transactionId`; a consumer
that is not idempotent may not subscribe to this bus.

The relay runs at two speeds. The request that just committed drains its own
tenant database inline — it already holds the handle, so the normal case reaches
the bus with the latency it had before the outbox existed. A daemon sweeps every
`tenant_*` database on an interval for what the fast path missed: the process
died after committing, or the broker was down when it ran.

### The bus reconnects, because otherwise none of the above delivers

Measured while verifying this, and older than it: **`amqplib` never
reconnects.** The channel `AmqpLayer` opened at boot was held in a `Layer` for
the process's life, so once the broker restarted it was dead permanently — and
both halves of the bus died with it. Publishes failed forever, and the saga
tracker's consumer stopped folding events without ever raising anything again.
The observed behaviour was an outbox that correctly survived a broker outage and
then never drained, the transaction stuck short of a terminal state until the
service was restarted by hand.

A second, sharper form of the same bug: a failed passive `checkExchange` _closes
the channel_ in amqplib. The readiness probe ran against the shared boot-time
channel, so one probe against a blipping broker permanently broke publishing and
consuming for everything else in the process. The health check was a way to
break the bus.

So `AmqpChannelTag` now carries a connector rather than a channel. It reopens on
demand, retries a call once against a fresh channel, and — the part that is easy
to miss — **re-registers every consumer against the new channel**, because a
subscriber's exclusive queue died with the old connection and nothing else would
ever rebind it. Connecting stays eager at boot, so an unreachable broker still
fails startup rather than leaving a service up with a silently dead bus.

Durability without delivery is not a fix, which is why this is in this record
rather than a follow-up.

### Local Mongo becomes a single-node replica set

Because none of the above exists on a standalone server. Production is a 3-node
replica set (one primary, two secondaries — the Atlas shape); dev is one node.
That is the same wire protocol, the same transaction semantics, and it silently
enables retryable writes fleet-wide.

What dev does **not** reproduce is elections and replication lag, so two rules
are written into the code rather than left to be discovered in production:

- **Drive every transaction with `session.withTransaction`**, never a
  hand-rolled `startTransaction`/`commitTransaction` pair. An election aborts
  in-flight transactions with a `TransientTransactionError` that the
  _application_ — not the driver — is expected to retry. A single-node set never
  raises one, so the hand-rolled version passes locally forever.
- **Keep non-transactional side effects outside the retried callback.** The
  product code is drawn from a Redis sequence; inside `withTransaction` a retry
  would consume a second value and leave a gap in the series. Redis is not part
  of the transaction and cannot roll back with it.

`directConnection=true` is appended to the seeded local URIs and is **local
only**. A replica set advertises its in-cluster member address, which resolves to
nothing on the host, so a discovering driver hangs against a healthy server.
Against a hosted set the URI is `mongodb+srv://`, where the same flag would pin
the driver to one member and defeat failover.

Initiation is a ladder rung (L5b), not a readiness probe. `rs.initiate()` runs
against a live pod and L4 waits for Ready before anything can exec one, so a
readiness probe demanding a primary would wait on an init that is waiting on the
probe. Enabling `--replSet` while authentication is on also makes mongod
_require_ a cluster keyfile and refuse to start without one — which is the single
most common way this conversion fails.

## Consequences

- Creating a record from the back office works, and the browser knows the id
  before the response arrives. Rendering the created record optimistically is now
  possible; actually doing it is #137's contract, not this record's.
- Retry is safe, which is what "recovery" (#135) needs in order to mean anything.
  Before this, retrying a command wrote a second record.
- The multi-step saga engine (#105) will be built on a bus that does not lose
  events rather than retrofitted onto one that does.
- **This does not weaken ADR 0022.** "A cross-domain write goes through the saga,
  never one transaction" stands. The transaction here is one domain, one slice,
  one database: the catalog entity and its outbox entry both live in
  `tenant_<organizationId>`, both written by `marketplace-admin`. Nothing spans a
  store boundary.
- A `dev:reset` is required. The configuration seed is
  `INSERT … ON CONFLICT DO NOTHING`, so an existing machine keeps the old Mongo
  URI and never reaches the replica set.

## Alternatives considered

**Keep the standalone server and embed the outbox marker in the entity
document.** One `insertOne` is atomic without a replica set. Rejected: it
pollutes the serialized entity shape (`serializeEntity` keys by `alias ?? name`,
so an infrastructure field has no home), cannot express an event for a delete,
and does not generalise to the multi-store writes M1–M6 need. It also leaves dev
and production on different transaction semantics permanently.

**Ordered writes with no transaction** — outbox entry first, then the entity,
then mark sent. Rejected: it inverts the failure into "an event published for a
write that never happened", which is worse than the bug being fixed.

**Put the outbox in `saga-coordination`.** One collection, one relay loop, no
database enumeration — operationally simpler today. Rejected on the two grounds
above: it makes the transaction cross-database from the first commit, and it
routes tenant payloads through the control plane as soon as `catalog.published`
uses it.

**Answer a repeated transaction id with `409`.** Rejected: see above — it makes
the correct client behaviour look like an error.

**Thread a session through `EntityRepository`.** The honest way to let the
generic repository participate in the handler's transaction. Rejected for now: it
puts a storage driver's concept into a framework-free port shared by a REST
adapter that has no sessions at all, to serve one caller. The handler writing
directly is a smaller cut. If a second handler needs it, a `UnitOfWork` port is
the thing to design — not an optional `session` argument added quietly.

## Residual risks

- **Duplicate publishes are normal, not exceptional.** Every consumer must dedupe
  on `transactionId`. Only the saga tracker subscribes today and it already does.
- **The sweep enumerates tenant databases.** Legal because `marketplace-admin` is
  the sole writer of every one of them, but it is a `listDatabases` per interval
  and will want a bound as the tenant count grows.
- **A single-node dev replica set never elects.** The `TransientTransactionError`
  retry path is therefore exercised by no local test. It is handled by
  `withTransaction` rather than by our own code, which is precisely why that
  helper is mandated instead of a hand-rolled pair.
- **The relay's sweep is what heals a dead subscriber.** Consumers are
  re-registered when the connector reopens, and the connector only reopens when
  something asks it for a channel. The sweep publishing every 15s is currently
  that heartbeat. A service that consumes but never publishes would not heal on
  its own — worth remembering before adding one.
