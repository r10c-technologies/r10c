# 31. A service describes its own wiring

- Status: Accepted
- Date: 2026-09-01

## Context

What a running service is actually connected to is knowable only by reading its
composition root.

`tools/slices/*.slice.ts` already **declares** it — `stores`, `publishedEvents`,
`subscribedEvents`, `exposedAPIs`, `dependantAPIs` — and `@r10c/slices` checks
those declarations against each other and against a source scan. What nothing
does is compare the declaration to what a process **did**. The gap is not
theoretical: ADR 0029 shipped a `publisher-exists` check and explicitly could not
assert that a declared event is ever emitted, because a source scan cannot see
emission. `marketplace-admin` declares `catalog.published` today and nothing
publishes it.

The same blind spot covers two other drifts. A service that opens a datastore
handle no slice declares creates the phantom store ADR 0020 struck
`marketplace_admin` from the register for. And a subscriber that binds a queue
with a pattern no declaration carries routes traffic the register cannot see —
which is exactly the class of fault the fanout-to-topic migration existed to
close.

Meanwhile the fleet already grows a readiness probe per datastore without anyone
writing a list, because `HealthProbe` ships with the client layer that
constructs the connection. That registry knows every backend a process talks to.
It simply does not say what any of them **are**.

## Decision

### `GET /api/$service`, on the effect-service shell

Mounted the way `withHealthRoutes` is, so a service gains it by composition. It
is a **sibling** of `/api/config`, never part of it: config serves the _inputs_ a
service was given (values, redacted); this serves its _shape_ (wiring).

It extends [ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)
and supersedes nothing. That record's per-entity choice was about **entity
affordances** — what a caller may do with one class — and stands untouched. This
is a different document about a different subject, which is also why it is not
`/api/$metadata` with `entity: '*'`, the wart 0026 rejected.

The document carries: the slice and its domains, the stores opened by logical
name, the events published and subscribed with each subscription's queue and
mode, and the upstream services called.

### The point is the diff, so the reader ships with it

The value is not the document. It is `declared` (`tools/slices/`) against
`observed` (the endpoints), which catches all three drifts above and nothing else
can.

So `pnpm run dev-infra:map` and the declared-vs-observed assertion (#184) are
part of this decision, not a follow-up. **If the reader is not built, the
endpoint should not be either.** This repository has already deleted one artifact
nothing queried — graphify's semantic pass, dropped after four runs and 922k
cumulative tokens because no CI job read `graph.json` and two sample queries
returned worse answers than a search — and the lesson was that a generated
artifact earns its keep by being _read_, not by being current.

### One source of truth: the health registry

`HealthProbe` gains `kind` (`datastore | broker | upstream`) and **`targets`**,
a list of logical names. Readiness and this document then generate from the
**same** registration, so there is no second list to drift — the same reasoning
that put the probe in the client layer rather than in a hand-written list in
`main.ts`.

`targets` is a **list**, not the single string this record first sketched. One
connection routinely backs several Stores: marketplace-admin-service opens one
Mongo client for `catalog` and for the co-deployed `transaction` slice's `saga`.
Registering one probe per Store was the alternative, and it is worse — the
readiness response's `failing` array is a list of probe names, so splitting them
would change an unauthenticated wire format to serve a gated document.

The names are the composition root's to supply, and that is the one place this
record's "a service gains a line with no edit of its own" promise is qualified:
a client package cannot know a Store's _register_ name, only that it has a
connection. So a service that gains a datastore writes the Store's name once, at
the line that opens it — which is where it is already choosing a database — and
nothing else in the service changes.

Subscriptions self-register when `subscribe` runs, into a `WiringRegistry`
beside the health one, so the document reports what the process actually bound
rather than what someone typed into a declaration. That is the whole point: a
document generated from the declaration would agree with the declaration by
construction and catch nothing. It is a **sibling** registry rather than a field
on the health one because a bound queue is not a readiness fact — nothing about
it can be probed — and folding the two together would put entries in the
readiness response that no probe can check.

Publishes are recorded the same way, by event **name** only and after the
publish succeeds. Recording the intent instead would let the diff pass for a
service whose every publish is failing; recording counts would be the per-replica
telemetry this record rejects below.

### Gated by `X-Service-Token`

This names every store, exchange and upstream a service has. That is a
reconnaissance map, and the repository's precedent on maps of the model is
uniform: `$metadata` answers `404` rather than `403` so it cannot be walked as an
oracle, readiness serves probe **names** only, `redactConfiguration` blanks any
item flagged secret because `/api/config` is unauthenticated.

The token is fleet membership, which is the right shape here — the readers are
`dev-infra:map` and CI, not a person and not a browser. The health endpoints stay
open, unchanged.

### Logical names only, and never a database name

`catalog`, never `mongodb://…`. And emphatically never `tenant_<organizationId>`:
the tenant databases are named after organizations, so enumerating them turns a
wiring document into a customer list. The store's **register name** is the only
correct answer, which is also the one ADR 0020 says is its identity.

### No metrics in it

Counters are per replica, unaggregated and un-alertable, and serving them here
would be a second telemetry path beside the one ADR 0001 already chose. "How many
messages were processed" is answered by OTLP metrics into Grafana (#185, #186),
not by a JSON endpoint that is right only if you happen to scrape the replica
that did the work.

### Three endpoints, one registry

Liveness stays process-only — the rule that keeps a Mongo blip from restarting a
healthy fleet. Readiness stays unauthenticated, ~1s cached and names-only, so it
cannot become a free lever on the datastore. The description is gated. They share
the registry underneath and nothing else; merging any two of them erodes exactly
the property that makes the other safe.

### The diff fails in one direction, and reports the other

`--check` fails when something **observed** is not **declared**: an event emitted
that no hosted slice declares, a store opened that none declares, a queue bound
on a pattern none carries, or a slice hosted by a deployment its own declaration
does not list. Both failures #184 names are that direction.

Declared and never observed is printed as an **advisory**. A fleet that has just
booted has published nothing, so asserting it would mean the diff passes only
after every flow has been exercised — a check that is red by default is a check
people learn to ignore. On today's fleet the advisories are exactly the three
drifts this record was written about: `catalog.published` declared and never
emitted, `marketplace`'s subscription to it never bound, and `published-catalog`
never opened.

Upstreams are reported and **not** asserted. `dependantAPIs` holds API strings
(`GET /api/config/:service`), not service names, so it is not comparable to a
probe's target; and Zitadel is a foreign system, correctly not a Store. Making
the two comparable means changing what `dependantAPIs` is, which is a separate
decision from this one.

## Consequences

- A service that gains a datastore gains a line in its own description, with no
  edit to the service, because the probe already ships with the client.
- The declared-vs-observed diff can finally assert emission, which ADR 0029
  deferred.
- Two documents describe a service now — `/api/config` for values and
  `/api/$service` for shape. Keeping them apart is deliberate: one is redacted
  because it holds credentials, the other is gated because it holds a map, and
  merging them would force the stricter rule onto both.
- The endpoint is one more unauthenticated-adjacent surface to get right. It is
  gated from the first commit rather than opened and narrowed later.

## Residuals

- A Store's name still reaches the document through a human typing it at the
  composition root. That is more honest than `tools/slices/` — it sits on the
  line that opens the connection — but it is not observation, and nothing can
  catch a name that is merely wrong rather than undeclared.
- The advisory half is the interesting half and it is not enforced, by the
  reasoning above. If a fleet exercise ever becomes a routine step, revisit it.
- `dev-infra:map` needs an address per deployment, which no `SliceDeclaration`
  carries. The table is in `tools/slices/src/fleet.ts` and `slices.spec.ts`
  checks it against the register in both directions, because a promoted slice
  missing from it would leave the diff passing by asking nobody anything.
