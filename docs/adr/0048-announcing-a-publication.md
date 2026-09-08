# 48. Announcing a publication, and a shared contract to announce it with

- Status: Accepted
- Date: 2026-09-07
- Area: messaging
- Read when: emitting or consuming a publication — the projector orders on `publishedAt`, and an unpublication leaves a tombstone because a delete has nothing to be ordered by
- Amends: [ADR 0009](0009-catalog-authoring-and-publication.md) — the projection
  runs on the outbox and the routed bus, not on the saga engine; the
  announcement it called missing now exists.
- Amends: [ADR 0047](0047-authoring-an-offering-and-the-publish-verb.md) —
  emission is no longer absent, and publishing now has a price precondition.
- Amends: [ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) — a
  handler failing with `EntifixBuildError` is **poison**, not transient.
- Revised: 2026-09-08 by [ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md)
  — the announced payload widened from seven members to eleven, and publishing
  gained a second precondition.
- Revised: 2026-09-08 by [ADR 0050](0050-rebuilding-the-published-catalog-from-tenant-storage.md)
  — the fleet-wide rebuild is built, and the cross-tenant surface this record
  said it needed turned out not to be one.

## Context

M1's chain is: author a `ProductOffering` → move it to `published` → emit
`catalog.published` → consume it and write the projection → the storefront reads
real data → delete the fixture. ADR 0047 built the first two links. This record
covers the next two
([#145](https://github.com/r10c-technologies/r10c/issues/145) and
[#146](https://github.com/r10c-technologies/r10c/issues/146)), which are one
change rather than two: an emitted event nobody consumes and a consumer with
nothing to consume are each useless alone, and they share the decision this
record opens with.

### Measured

The register **already declared both sides** — `marketplace-admin.slice.ts`
published `catalog.published`, `marketplace.slice.ts` subscribed it — while
nothing emitted it and nothing bound the queue. ADR 0031's `/api/$service` diff
was reporting exactly that as three advisories: an event declared and never
observed, a subscription never bound, and `published-catalog` never opened. Those
advisories were right, and this record is what clears them.

`PublishedOffering` already existed with the members a snapshot needs, and
marketplace-service already **served reads of it**. It had no writer. The service
itself said so: `apps/marketplace-service/src/mongo.ts` carried the comment "No
Redis and no AMQP yet", and had no `rabbitmq.uri` row, no `amqplib`, and no AMQP
readiness probe.

⚠️ **Two claims in #145 are stale and were not followed.** "The register edit
comes first" was already done. And "this is a dual write, #134's outbox is the
durable answer; until it lands the mitigation is the rebuild path" is void —
#134 landed, so the event goes in the same Mongo transaction as the status
write, and the fleet-wide rebuild loses the justification the issue gave it. See
the last consequence.

## Decision

### The payload type gets a `business:policy` package

`product-configuration-management` authors the publication and
`marketplace-catalog` projects it. A `business:domain` package may never depend
on another, so the payload cannot be shared through either of them; that is the
constraint ADR 0047 named when it deferred this.

The repository had already predicted the answer. `settlement-management`'s
duplicated channel-type literals carry a comment saying: _"the real fix — if
this ever bites — is a shared `business:policy` vocabulary package, not a
dependency edge"_ (ADR 0024). Four copied strings did not bite. A seven-member
payload with a decoder does, because nothing can mechanically compare two
hand-written copies of a structure: a member added on one side only is a field
the projection silently never writes, invisible in both test suites and visible
on the storefront as data that simply never arrived.

So `@r10c/business-ts-catalog-contracts` is `business:policy`, which is the tag
a domain package **is** allowed to depend on. That widens `business:policy` from
"the shared _authorization_ vocabulary" to "shared vocabulary a domain may
express itself in", and the widening is stated rather than smuggled. What keeps
it honest is unchanged and is enforced by `@nx/enforce-module-boundaries`:
`business:policy` may depend only on `layer:entifix` and `layer:utils`, so
nothing in that package can reach an entity, a use case or a repository. It
holds a payload type, two event names, two builders and a decoder — no
behaviour.

**Not** in scope: moving `settlement-management`'s channel literals in. Their
decision stands; only their predicted remedy now exists.

Rejected: **duplicate the payload on both sides and pin each copy with its own
spec**, the ADR 0024 precedent applied literally. It is the cheaper change and
it is what ADR 0024 chose for its own case — but neither spec can see the other
package, so the pins assert two copies against themselves and the drift they
exist to catch is exactly the thing they cannot observe.

Rejected: **a source scan in `tools/` comparing the two copies**, the shape
`@r10c/slices` uses to check verbs against grants without an import edge. A
regex over two type declarations catches a renamed member and misses a retyped
one — `string` to `number` reads identically — and the failure it would miss is
the one that corrupts a price.

### Two event names, one queue

`catalog.published` and `catalog.unpublished`, and the consumer binds them with
a single `catalog.*` pattern.

Two names because a state member inside one name means every consumer branches
on the payload to learn what happened, and the register then cannot say which
events exist. One queue because `queueNameFor` derives the durable queue from
the subscription's pattern: two subscriptions would be two queues delivering
**independently**, which is precisely how a redelivered unpublication overtakes
the publication that superseded it.

Settled now because it can only be settled now. A queue's name and its
`x-delivery-limit` are immutable once it exists — re-declaring either fails
`PRECONDITION_FAILED` and closes the channel — and nothing has bound this one
yet.

### ⚠️ The projection's write is guarded on `publishedAt`, and that is correctness

The register calls this subscription `dedupe: 'natural'`, justified as "the
projection is a full-document upsert keyed on the offering id, so re-applying one
publication writes the same document". That is true for a publication and
**false for an unpublication**, which deletes.

At-least-once delivery can therefore land a redelivered `catalog.unpublished`
after a newer `catalog.published` and remove a listing that is legitimately live
— permanently, silently, and with every probe green. So `CatalogPublication`
carries `publishedAt`, `PublishedOffering` stores it, and the projector ignores
an event older than the record it holds. Both operations are idempotent; neither
is order-free, and this is what separates those two properties.

Three details that are not obvious from the code. Equality **applies** rather
than skips, because treating equal as stale would drop the first delivery
whenever a record already carried that moment. A stored document with no
`publishedAt`, or one whose value is not a `Date`, compares as the **epoch**, so
every real publication supersedes it — the opposite default freezes such a
record permanently and invisibly, and comparing against a string yields `NaN`,
which makes every comparison false in exactly that direction. And the moment
comes from the **publisher's** clock, carried in the payload: the receiving time
would order messages by when the broker happened to deliver them, which is the
thing being defended against.

#### ⚠️ An unpublication leaves a tombstone, because a delete cannot be ordered

Comparing against the stored record is only half the guard, and the missing half
was found by exercising the running fleet rather than by reasoning:

> Publish an offering and unpublish it 19ms later. Each request forks its own
> inline outbox drain, the two raced, the unpublication was delivered **first**
> — its delete found nothing and left nothing behind — and the publication that
> followed looked exactly like a first publication. Measured result: the
> storefront went on showing an offering whose tenant-side record said
> `unpublished`, with both requests answering `200` and every probe green.

A delete has nothing to be ordered by. So an unpublication now writes a
tombstone (`<projection>-tombstone`, keyed on `offeringId`, carrying the event's
`publishedAt`) **before** removing the record, the guard compares against the
record _or_ its tombstone, and a publication clears the tombstone it supersedes.

Three consequences worth stating. The tombstone is written **first**, because
between the two writes the offering must never look publishable again. It is a
separate collection rather than a `deleted` flag on the record, because
`published-catalog` is read through the entity's own collection by
`makeMongoRepository` and a soft-deleted row would need every reader to remember
to filter it — and because ADR 0009 says a `projection-of:` store must not keep
rows its source no longer has. And the guard **orders rather than freezes**: a
vendor who unpublishes and changes their mind still reaches the storefront,
verified live.

This was reasoned about while planning and written off as a rare redelivery
edge. It is not an edge — two operator clicks a second apart reproduce it — and
the hermetic suite could not see it, because a stub returning fixed answers
cannot express the second write seeing what the first one left.

### The event id is `<offeringId>:<publishedAt>`

Not the offering id alone. ADR 0047 made `published → published` legal because
republication is how a vendor's correction reaches the storefront — so an id
keyed on the offering would make every correction look like a redelivery of the
first publication, and the outbox's unique index would drop it. Same rule
`transactionEventId` follows for `<transactionId>:<step>`: one subject emits many
messages, so the subject alone is not an identity.

### The transition decides; the route commits

`transitionOffering` used to read, mutate and `save`. Saving there and writing
the outbox entry separately is the dual write ADR 0028 exists to forbid: a broker
outage between the two leaves an offering `published` on the vendor's own screen
and absent from the storefront forever, with nothing to replay from.

A driver session may not enter the framework-free `EntityRepository` or
`TransactionOutbox` ports — ADR 0028 rejected threading one through by name — so
the use case now **returns** `{ offering, event }` and saves nothing, and
`transitionOfferingRoute` writes both documents in one `session.withTransaction`.
That is the same shape `makeCatalogTransactionHandler.execute` already uses for
its `completed` entry, and `outboxDocument` was already exported as the escape
hatch for exactly this caller. The relay's fast half then runs inline, as
`createTransactionRoute` does, so a publish reaches the bus immediately rather
than waiting out the 15s sweep.

Two mechanics worth not re-deriving. The event is built **before** the
transaction opens, so a `TransientTransactionError` retry re-sends the same
payload rather than stamping a new moment — the same rule that keeps the Redis
sequence draw outside `withTransaction`. And `vendorId` comes from
`guardedUseCase`'s `organizationId`, which the two route registrations were
already handed and were discarding: it is read from the **verified principal**,
never a body member, because it decides which vendor a storefront row is
attributed to and, once orders exist, who is paid for it.

### ⚠️ Publishing without a price is refused, `409 offeringHasNoPrice`

ADR 0047 recorded this precondition as absent and said the honest place for it is
"the commit that makes the projection depend on it". This is that commit:
`CatalogPublication` carries `amount` and `currency`.

The alternatives are both worse in ways that are hard to see later. Projecting
`0` is indistinguishable from _free_ at checkout, and the vendor never authored
it. Emitting anyway and letting the consumer drop it gives the vendor a `200`
and a listing that never appears, with the only evidence in another service's
log — the wrong service, and nobody is watching it.

It needs a second repository, so the use case gained
`OfferingPriceRepositoryTag`: a separate tag rather than a second use of
`EntityRepositoryTag`, because one tag resolves to one value and a repository
built for `ProductOffering` answering a price query returns documents that
deserialize into the wrong class rather than failing. The refusal is ordered
**after** the legality check — an unpublishable draft must be told it is
unpublishable, not that it has no price, which would send the vendor to fix
something that is not wrong.

`409` for the same reason `illegalOfferingTransition` is: the request is
well-formed and the caller is allowed to make it. What is wrong is the state of
the record.

### `availableHint` is `true`, and says why

Nothing computes availability: the `stock` slice is `planned` and M2 is what
gives this member a source. `true` rather than `false` because the storefront's
badge is a hint and the checkout reservation is the truth (ADR 0009, ADR 0010) —
publishing everything as unavailable would make the hint say nothing while
looking like it says something.

### marketplace-service grows a bus, and therefore a probe

`AmqpLayer` → `AmqpEventBusLayer` → `startProjecting`, plus `amqplib` in
`externalDependencies` and a `rabbitmq.uri` row in config-service's seed.

⚠️ And `AmqpHealthProbeLayer`, which is not optional. A service that dials
RabbitMQ at boot and probes nothing exits `1` against a broker that is merely
slow, while the health ladder green-lights a fleet that is still coming up —
every `infra/local/*` deployment must declare a protocol-level probe, and this
service was about to depend on one it never checked.

It registers no shutdown hook of its own: `AmqpEventBusLayer` already registers
the `stop-intake` drain that cancels consumers and waits for in-flight
deliveries, and the projector forks no daemon. `EventSourceTag` is still
provided, because the bus is one port with both halves and a source resolved at
the composition root is what keeps a future publish from being signed by nobody.

marketplace-service had **no test project at all** — no vitest config, no specs.
It has one now, because the ordering guard above is the correctness half of this
change and it cannot be asserted from anywhere else.

## Alternatives rejected

**Have marketplace-admin write the projection directly.** It is one fewer hop and
the data is right there. Rejected because it puts the public read host's store
under a second writer and, worse, gives the tenant-plane service a reason to hold
a platform-plane handle. ADR 0009 and ADR 0022 both choose consumer-writes so the
isolation is structural rather than a rule about which query a route makes.

**A merge instead of a wholesale replace.** Cheaper writes, and it would let a
publication carry only what changed. Rejected by ADR 0009 and restated here:
derived data with a partial update path drifts from its source in ways nothing
detects.

**Leaving a contract rejection classified as transient.** The adapter mapped
every handler failure to `transient`, so a payload this package's own decoder
rejected was requeued and retried to `x-delivery-limit` before reaching the
quarantine it belonged in immediately — measured at five deliveries. That is
precisely what ADR 0030 gives poison zero retries to avoid: it spends the budget
of every message behind it, and a payload that fails the contract never becomes
valid. `EntifixBuildError` already means "malformed input, the client's fault",
so the adapter now reads it as poison and everything else stays transient — a
Mongo blip must still be retried. The transport cannot make this call itself:
`readEventEnvelope` validates `meta` and deliberately not `data`, because
"inventing an opinion here is how the bus would start knowing about domains", so
the consumer's own decoder is the only thing that can tell a malformed payload
from a bad afternoon at the database.

**`dedupe: 'inbox'` for the projector.** It is the stronger mechanism and it is
already built. Rejected because the claim + side effect must commit in one
transaction, which would put a `transaction_inbox` collection in a store with no
transaction machinery — and because the guard above makes the natural claim
actually true, which is the cheaper correct answer.

## Consequences

- **`published-catalog` fills.** Publishing an offering makes it appear within
  seconds; unpublishing removes it; a redelivery changes nothing; a stale
  unpublication is ignored.
- **Three ADR 0031 advisories clear at once** — the declared-and-never-emitted
  event, the never-bound subscription, and the never-opened store. That the diff
  named all three before anything was built is the check working as designed.
- **`business:policy` means something slightly wider now.** One package, one
  payload; the tag's dependency ceiling is unchanged and still enforced. If a
  second unrelated contract wants in, that is the moment to ask whether the
  package is a vocabulary or a drawer.
- **An offering whose only price is deleted cannot be unpublished** through this
  path, because the announced payload has the same shape either way. Recorded
  rather than worked around: a payload that changed shape by event name would be
  two decoders and two ways for the ordering guard to be skipped.
- **Several prices for one offering is unresolved.** The projector takes the
  first; choosing between a list price, a promotional one and a per-currency one
  is a decision rather than a default, and SID separates them precisely because
  it is a real one.
- ⚠️ **The fleet-wide rebuild is deferred, and the reason first given here for
  deferring it was too strong.** #145 asked for a walk across every organization
  re-emitting every published offering, "because it is also the recovery
  mechanism for every event lost before #134". This record initially answered
  that #134 landed, so the event is written in the same transaction as the status
  and **nothing is lost**. The write is atomic; _delivery_ is not unconditional.
  Measured during the live pass: with the broker stopped, the relay retried the
  pending entry to `outbox.maxAttempts` and **quarantined** it — ADR 0030's
  deliberate "quarantine and skip so the head of the line moves" — after which
  the offering read `unpublished` in the tenant store and stayed live on the
  storefront, with nothing reporting it. So an outage longer than the relay's
  ceiling does drop an announcement, and the projection is then wrong in a way
  only a rebuild fixes.

  What is true is narrower: the repair exists **per offering**, because ADR 0047
  made `published → published` legal, and republishing converges the projection
  (verified). The fleet-wide walk stays out of this batch because it needs a
  cross-tenant surface and ADR 0012's audited human crossing is still Proposed —
  but it is a real gap, not an operator convenience, and it should be built
  before anything depends on the projection being complete rather than fresh.

- **Quarantined outbox entries are invisible.** The relay logs and the
  `outbox_quarantined` gauge counts, but nothing ties a quarantined
  `catalog.*` entry back to the offering it was announcing, so the operator-facing
  symptom is a storefront that disagrees with the vendor's screen. Worth a
  reconciliation check once the rebuild exists.
- **Tombstones accumulate**, one per unpublished offering. Small, and the price
  of an orderable delete; a retention sweep could prune those older than any
  message the broker could still redeliver.
- **The storefront still reads fixtures.** #147 and #148 are the next batch;
  nothing here is blocked on them, and the fixtures are
  `ProductSpecification`/`ProductBrand`/`ProductCategory` rather than
  `PublishedOffering`.
