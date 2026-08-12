# 20. Stores and Slices: naming the unit of data ownership and the unit of deployment

- Status: Accepted
- Date: 2026-08-11
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  the register table below is superseded by the live one (12 stores, 9 slices);
  `SliceDeclaration` gains `status: 'active' | 'planned'`; the
  `published-catalog` follow-up is done.

## Context

The question that produced this record: if one part of the system consumes
disproportionate resources, can it be lifted into its own deployment and fed by
an ingress rule or a queue, without moving domain code?

The mechanism is already there. Use-cases take ports rather than transports,
dependencies are wired as `Layer`s at a single composition root, no URL is
hardcoded because config-service resolves them, and `makeService({ router,
appLayer })` already accepts a router as an input rather than hardcoding one.

What is missing is not mechanism. It is **vocabulary**.

[ADR 0008](0008-domain-modules-and-service-topology.md) stated the rule that
makes a split possible — one writer per database — and then attached it to
nothing. There is no name for "a database" in this system, so the rule cannot be
checked, cannot be declared, and cannot be violated visibly. Everything the rule
protects is enforced by review.

Reading the fleet against that rule surfaced three things that had no way to be
said out loud:

- The Mongo database `marketplace_admin` is connected at boot and **written
  never**. Every catalog route re-provides a tenant handle. It is a persistence
  boundary with no contents and no purpose, and nothing flagged it.
- The Mongo database `auth` holds the entities of **two** domains — `authn` and
  `party-management`. That may be correct, but it is an unrecorded commitment:
  those two domains can no longer be separated without a data migration.
- Redis serves **two** unrelated key spaces — auth's sessions and
  marketplace-admin's saga locks and sequences. Whether that violates one writer
  per database depends entirely on whether "database" means the server or the
  key space, and nothing said which.

Each is a question about ownership that the codebase could not phrase. That is
the gap this record closes.

## Decision

Two nouns, locked: **Store** and **Slice**.

### A Store is a persistence boundary with exactly one writer

> A **Store** is a named persistence boundary with exactly one writing slice, one
> plane, and a stable identity independent of the engine that backs it.

Six attributes, all mandatory:

| Attribute      | Meaning                                        | Example                            |
| -------------- | ---------------------------------------------- | ---------------------------------- |
| `name`         | stable identity, independent of any engine     | `auth`, `catalog`, `configuration` |
| `plane`        | control / platform / tenant — **who may read** | `tenant`                           |
| `owner`        | exactly one slice — **who may write**          | `marketplace-admin`                |
| `hosts`        | the domains whose entities live here           | `product-configuration-management` |
| `partitioning` | `single` / `per-organization`                  | `per-organization`                 |
| `truth`        | `system-of-record` / `projection-of:<store>`   | `system-of-record`                 |

**`engine` is deliberately not part of identity.** Mongo, Postgres and Redis are
deployment facts. [ADR 0013](0013-tenant-storage-on-postgres.md) already relies
on this without having the word for it: moving tenant storage from
database-per-organization on Mongo to schema-per-organization on Postgres changes
the engine and the partitioning mechanism while the store — `catalog`, tenant
plane, owned by `marketplace-admin` — is the same store throughout.

Two consequences fall straight out, and both settle open questions:

- **An engine instance may host many Stores. A Store may never span engines.**
  Store identity is the key space plus its owner, not the server. Auth's
  `session:*` and marketplace-admin's saga keys are therefore two stores sharing
  one Redis. No rule was being bent; there was no way to say so.
- **A Store's name is not its database name.** `catalog` is physically
  `tenant_<organizationId>`. The physical name encodes partitioning; the store
  name does not.

### A Slice is the unit of ownership and of physical split

> A **Slice** is the unit that owns Stores and is the unit of physical split. It
> holds one or more domains, owns zero or more stores, and is realized as one or
> more deployments.

Four levels, each with exactly one job:

```
Domain      business/ts/authn            business meaning, permission namespace
   ↓ its entities live in exactly one
Store       auth                         persistence boundary, one writer
   ↓ owned by exactly one
Slice       auth                         ownership + the unit of physical split
   ↓ realized as one or more
Deployment  auth-service, auth-oidc      the Kubernetes objects actually running
```

`Deployment` deliberately reuses the Kubernetes word, because it _is_ the
Kubernetes object. Inventing a synonym for something the platform already names
would be the same error as prefixing `Store` with `Domain`.

A Slice and its Store may share a name — the `auth` slice owns the `auth` store —
and that is a feature. When the two names **diverge**, the divergence is
information: a slice named `marketplace-admin` owning a store named `catalog`
says the slice is broader than the store.

### Only a Slice owns Stores; a Next app belongs to no Slice

This restates the existing `host:next` ✗ `runtime:datastore` boundary rule from
[ADR 0008](0008-domain-modules-and-service-topology.md) as ownership rather than
as an import ban — the same rule, now with a reason attached. It also answers
what the Next apps _are_: not slices, and not orphans, but **composition over
slices**.

### The Store↔Domain relation is not 1:1, and that is the point

Three invariants:

1. **A domain's entities live in exactly one Store.** A domain spread across two
   stores cannot be written transactionally and cannot be moved. If it needs two,
   it is two domains — or the second is a projection.
2. **A Store has exactly one writing Slice.** This is ADR 0008's rule, restated
   as a property of a named thing rather than a convention about an unnamed one.
3. **Two domains sharing a Store are permanently co-deployed.** Not forbidden —
   but it is a _binding decision_, and it must be recorded as one.

Invariant 3 is what earns the whole vocabulary. `authn` and `party-management`
share the `auth` store today. Under this record that stops being an accident
someone discovers mid-split and becomes a declared statement: **identity and
party cannot be separated without a data migration.** It is accepted as-is —
splitting speculatively is work against a need that does not exist — but it is
now written down, which is the entire difference.

### `truth` is what distinguishes a projection, not its exclusion

A projection is not a lesser thing than a store; it is a store with an upstream
owner. Modelling it as `truth: projection-of:<store>` keeps one-writer applying
to projections (only the projector writes it) and makes the published catalog a
first-class, nameable store rather than an exception.

This gives [ADR 0009](0009-catalog-authoring-and-publication.md) its vocabulary.
"Two catalogs, one projection" is precisely two stores: `catalog` (tenant,
`system-of-record`, owned by `marketplace-admin`) and `published-catalog`
(platform, `projection-of:catalog`). [ADR 0012](0012-operator-cross-tenant-access.md)'s
"cross-tenant reporting is a projection, not a crossing" is the same shape, and
becomes checkable: a reporting store declaring `projection-of:` is by
construction not a crossing.

### What is not a Store

The taxonomy matters as much as the definition:

- **Cache** — derivable and droppable. Losing it costs latency, never
  correctness.
- **Transport** — RabbitMQ. Messages in flight, not state at rest. The saga's
  `transactions` collection _is_ a store; the fanout exchange is not.
- **Foreign system** — Zitadel's Postgres. It has an owner, and the owner is not
  us. Reached only through its API, which is exactly what
  [ADR 0016](0016-zitadel-authenticates-r10c-authorizes.md) already requires.

### Plane becomes a property of the Store

[ADR 0006](0006-multitenancy-planes-and-tenant-storage.md) makes the plane part
of an _entity's_ definition. This record moves it one level out: entity → store →
plane, so an entity's plane is **derived** from the store that hosts it.

This is a tightening, not a reversal. Everything 0006 decides stays true — the
three planes, the rule for choosing one, organization-agnostic entities, the
request-level tenant handle. What changes is that two entities in one store can
no longer disagree about their plane, because they no longer each carry one.

### Slice, not plane, is the topology axis

[ADR 0008](0008-domain-modules-and-service-topology.md) organized the fleet as
"three plane-hosts": `marketplace-service` as the platform host,
`marketplace-admin-service` as the tenant host, `auth-service` as the control
host. That framing is superseded.

It fails as soon as [ADR 0009](0009-catalog-authoring-and-publication.md) lands:
publication makes `marketplace-admin` own both the tenant `catalog` store and,
plausibly, the platform-plane `published-catalog` projection. A host cannot be
"the tenant host" while owning a platform store. Plane is a property of the
store; a slice may own stores in more than one plane.

The topology axis is **ownership**. A slice is a set of stores with one writer
and the domains that write them. What 0008 got right and this record keeps: one
writer per database, the three forbidden couplings, and that all of it is a
property of code structure rather than of process count.

### TM Forum: the Slice is an ODA Component; the Store has no ODA name

Consistent with [ADR 0005](0005-business-domain-decomposition.md) — borrowed
where it fits, not adopted wholesale.

**Validated.** An ODA Component is "an independently deployable piece of
software, typically built from one or more microservices, with its integration
defined through specified Open APIs", and it has a **boundary**: inside it, the
implementer is free to choose any internal data store; across it, the component
must expose the Open APIs of the function it implements and publish the events it
emits. That is the Slice, including the part that matters most here — the store
is _inside_ the boundary and invisible across it, which is the same statement as
"no slice reads another slice's store".

**Borrowed.** The component definition's declaration fields are the right names
for a slice declaration, and they are already thought through:
`coreFunction`, `managementFunction`, `securityFunction`, `exposedAPIs`,
`dependantAPIs`, `publishedEvents`, `subscribedEvents`. A slice declaring
`exposedAPIs` and `dependantAPIs` says exactly what a split needs to know.

**Not adopted, and recorded as a third delta.** ODA has **no vocabulary for data
ownership**: the component boundary is deliberately opaque, so the guidelines
name neither the data store, nor its ownership, nor the relation between a
component's data and the SID entities it manages. `Store` is ours. This sits
beside the two deltas ADR 0005 already records — ODA is silent on multi-tenancy,
and ODA's "Product Inventory" is not stock — and it has the same character: where
ODA is silent because a vendor's internals are its own business, a single
codebase still has to decide.

Sources:
[IG1171 ODA Component Definition](https://www.tmforum.org/resources/best-practice/ig1171-oda-component-definition-v4-0-0/),
[ODA Component Design Guidelines](https://tmforum-oda.github.io/oda-ca-docs/docs/ODAComponentDesignGuidelines.html),
[IG1245 Principles to Define ODA Components](https://www.tmforum.org/resources/standard/ig1245-principles-to-define-oda-components-v1-0-0/).

### The declaration is an artifact, not prose

A `slice:*` tag would get lint enforcement, but tags are per-project and a slice
will eventually span projects. The truth belongs in a declaration — one per
slice, naming its stores with their six attributes, its hosted domains, and its
exposed and dependent APIs — with the tag derived from it.

That converts the invariants into tests: every `@entity()` domain resolves to
exactly one store, every store to exactly one owning slice, and no slice binds a
repository to a store it does not own. Invariants 1 and 2 stop being prose.

### The register as it stood when this record was written

> **Revised 2026-08-12.** This table is 2026-08-11's register, kept because the
> three calls below are reasoned against it. The live register is
> `tools/slices/` — mirrored in [docs/\_shared/planes.md](../_shared/planes.md) —
> and it now holds **12 stores across 9 slices**
> ([ADR 0022](0022-v1-marketplace-module-boundaries.md)). Two corrections to what
> is below: `auth` hosts **three** domains, not two (`access-management` as well,
> found the moment the invariants first ran —
> [ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md)), and
> `configuration`'s hosted domain is named `config`.
>
> The vocabulary also gained `status: 'active' | 'planned'`, so a slice can own
> stores before a process runs them. That extends the Slice and leaves the three
> invariants **untouched** — they apply to a planned slice exactly as to an active
> one, which is what makes recording ownership early worth doing. What a planned
> slice may not do is claim a deployment, for the same reason `marketplace_admin`
> is absent below.

| Store               | Plane   | Owner slice         | Hosts                               | Partitioning     | Truth            |
| ------------------- | ------- | ------------------- | ----------------------------------- | ---------------- | ---------------- |
| `auth`              | control | `auth`              | `authn` **+** `party-management` ⚠️ | single           | system-of-record |
| `session`           | control | `auth`              | — (session records, no entities)    | single           | system-of-record |
| `catalog`           | tenant  | `marketplace-admin` | `product-configuration-management`  | per-organization | system-of-record |
| `saga-coordination` | control | `marketplace-admin` | —                                   | single           | system-of-record |
| `configuration`     | control | `config`            | `configuration`                     | single           | system-of-record |
| `saga`              | control | `transaction`       | —                                   | single           | system-of-record |

Three calls made here, each overturnable:

- **`saga` is control plane; there is no fourth plane.** A saga log is the
  platform's own operational record, which is what 0006's control plane already
  means ("the platform itself"). Adding a plane would dilute a distinction that
  currently answers exactly one question — who may read this.
- **`saga-coordination` is a Store, not a cache.** Its locks are droppable, but
  its sequence counters are not reconstructible, and a boundary containing one
  non-reconstructible thing is a store. If the sequences later move, it degrades
  to a cache and the declaration says so.
- **`marketplace_admin` is not in the register.** A persistence boundary with no
  contents and no writer is not a store; it is a connection nobody uses. It is
  deleted, and the platform-plane store arrives under its own name
  (`published-catalog`) when ADR 0009 lands.

### Rejected: `DomainStore` and `DomainSlice`

Both assert a cardinality that is false. `DomainStore` reads as one store per
domain — but `auth` hosts two. `DomainSlice` reads as one slice per domain — but
the `auth` slice holds `authn`, `party-management` and `authz`. A name that
misstates the cardinality is worse than a generic one, because the cardinality is
what the whole design turns on: a reader would expect a store per domain, fail to
find one, and conclude the code was wrong.

Kinship between the two nouns comes from a declared relation — `Slice owns Store`
— and from living in one declaration file. That tie is checkable; a shared prefix
is not.

### Rejected: reusing `scope:` as the Slice

Tempting, since the tag exists and the boundary rule already enforces it. But
`scope:shared` is a scope that is **not** a slice, and `scope:marketplace` spans
a Next app _and_ a service. Scope ⊇ Slice, so reusing the word would hide a real
mismatch. It also collides with OIDC scope in a codebase where that word is load
bearing.

### Rejected: `Cell`

Accurate — cell-based architecture means an independently deployable,
independently scalable unit that owns its data. Rejected only because it carries a
stricter claim than is being made: a cell implies replica-for-blast-radius, and
nothing here yet needs that. `Slice` is the weaker, truer word for what exists.

## Consequences

- **Three ADRs need amendment, not replacement.** 0008's "three plane-hosts"
  topology table is superseded by slice-owned stores; 0006's "plane is part of an
  entity's definition" becomes "plane is a property of the store, and an entity's
  plane is derived"; 0009 and 0012 gain `truth: projection-of:` as the name for
  what they already describe.
- **The glossary gains two entries and loses precision in one.**
  `Store` and `Slice` are added to BUSINESS-ARCHITECTURE's glossary; the existing
  `Plane` entry ("part of the entity's definition") is rewritten to point at the
  store.
- **`marketplace_admin` gets deleted.** A connection at boot to a database with
  no collections, plus its config rows.
- **`authn` + `party-management` sharing `auth` is now a recorded binding.**
  No code changes. The cost is stated where someone planning a split will read
  it, which is the whole point.
- **Naming cleanup follows, in three tiers.** `SessionStore`,
  `OneTimeTokenStore` and `TransactionStore` **stay** — they are ports into the
  store of the same name, which is now a precise statement instead of a
  coincidence. `ConfigurationStore` was an HTTP client and is now
  `ConfigurationClient`. The three browser-side ones — `TabsState`,
  `DraftsState`, `UiPreferencesState` — held no persistence boundary at all and
  are now `…State`.
- **Two slices are already portable, and this is now checkable rather than
  asserted.** `config` and `transaction` each own exactly one store, write
  nothing else, and take their input from HTTP and a queue respectively.
  `marketplace-admin` is a file move away — its storage is already
  per-organization, so a shard-by-organization split needs no coordination.
- **`auth` is not close, and the vocabulary says why.** ~1200 lines in
  `apps/auth-service/src/routes.ts` hold `establishSession`, the OIDC callback,
  back-channel logout and provider events welded to `HttpRouter`, while
  `business-ts-authn` exports three use-cases and the adapters live in the app.
  A slice whose logic is not in its domain packages cannot be lifted; it can only
  be copied.
- **The location rule this implies is the real follow-on work.** A slice's
  routes, adapters and handlers belong in its domain packages, leaving
  `apps/<slice>-service/` with config resolution, layer wiring and `main.ts`.
  Then a split is a new `main.ts` plus a routing rule, and the slices become
  uniform instead of two-portable / two-not.

## Follow-ups (deliberately out of scope)

- ~~The slice declaration format, and the tests that assert the three
  invariants.~~ **Done** — `tools/slices/` holds the register as typed
  declarations and `slices.spec.ts` fails the build on a violation. See
  [ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md), which also
  records what the tests found the moment they first ran: `access-management`
  makes `auth` a three-domain store, not the two stated above.
- Moving `auth`'s logic and adapters out of `routes.ts` into `business-ts-authn`.
- ~~`published-catalog` as a declared store, when ADR 0009 is built.~~ **Done** —
  declared by [ADR 0022](0022-v1-marketplace-module-boundaries.md), owned by the
  `marketplace` slice, with `truth: projection-of:catalog`. The writer is the
  **consumer** of `catalog.published`, not the slice that authored the offering,
  which is what keeps the public read host out of tenant storage entirely.
- Whether a slice's second deployment is addressed by an ingress rule or by a
  queue. Both are compatible with this record; neither is needed yet.
