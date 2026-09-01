# 31. A service describes its own wiring

- Status: Proposed
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

`HealthProbe` gains `kind` (`datastore | broker | upstream`) and `target` (a
logical name). Readiness and this document then generate from the **same**
registration, so there is no second list to drift — the same reasoning that put
the probe in the client layer rather than in a hand-written list in `main.ts`.

Subscriptions self-register when `subscribe` runs, so the document reports what
the process actually bound rather than what someone typed into a declaration.
That is the whole point: a document generated from the declaration would agree
with the declaration by construction and catch nothing.

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

## Trigger

Promoted to Accepted by #183 (the endpoint) together with #184 (the reader and
the diff), which depend on #182 (probes declaring what they probe). #183 should
not merge without #184.
