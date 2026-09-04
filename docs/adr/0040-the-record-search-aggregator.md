# 40. The record search aggregator fans out per request and ranks nothing

- Status: Accepted
- Date: 2026-09-04

## Context

The command palette ([#112](https://github.com/r10c-technologies/r10c/issues/112),
[#129](https://github.com/r10c-technologies/r10c/issues/129)) has to find
_records_, not only destinations. Nav entries come from `visibleNav(roles)` and
open tabs from `useTabsState`, but nothing in the fleet answers "which records
match `acme`".

Records live behind four services. `ProductSpecification` is tenant-plane on
marketplace-admin-service (`:3101`); `ProductBrand` and `ProductCategory` are the
platform-plane vocabulary on marketplace-service (`:3100`); `UserIdentity` is on
auth-service (`:3102`). ADR 0022 fixes 28 entities across 11 domains, so the
number of places a record can live only grows.

The obvious implementation is an index: fetch what the caller may see once, keep
it in the browser, filter locally. It is fast, it is offline-friendly, and it is
a tenant breach. Searching "Juan" must never surface a record from another
organization, and an index built once and filtered client-side is exactly the
shape that gets that wrong the first time a session's scope changes underneath
it.

### What already exists

The query protocol is uniform and already carries the authorization: a list
request is `?rsql=&sort=&page=&pageSize=`, `parseLoadRequestParams` validates it
against the entity's own metadata, and a member's `filterable` flag **is** the
server-side allowlist. Every list answers an `entityPage` envelope. Every route
is behind `requirePermission`, and tenant-plane ones additionally resolve the
caller's organization database.

So the authorization question is already answered per source. What was missing
was a way to ask several at once.

## Decision

**`GET /api/search` on the Next host fans out to the sources it mounts, carrying
the caller's own session, and returns grouped results.** No index, ever.

### The caller's session and nothing else

Each source is asked over the same guarded route its screens use, with the
caller's `r10c_at` forwarded as a bearer. No service token, no elevation, no new
tenant-crossing path — a tenant-plane source resolves its handle from the session
exactly as its own routes do, so [ADR 0023](0023-service-to-service-tenant-crossing.md)
remains the single named crossing.

The route answers `401` when there is no session cookie, and this is **not**
redundant with the services' own guards. `catalog-reference` reads are
unauthenticated at marketplace-service by design — the storefront serves
anonymous traffic — so without the gate a signed-out caller would get brand and
category matches back and the response would read as a successful search that
found nothing else. It also stops the endpoint becoming an anonymous amplifier
against that service.

⚠️ A consequence worth stating plainly, because #129 phrases it more strongly
than is true: for two of the four sources, "every result comes from a guarded
endpoint" is **not literally the case**. What authorizes brands and categories is
this route's own `401` plus ADR 0022's ruling that the reference vocabulary is
platform-plane and permanently non-grantable — nobody buys the taxonomy every
vendor is classified into, so nobody may be refused it.

### Fan out to the services, not through this app's own proxies

The issue that asked for this said "fanning out to the same-origin proxies it
already mounts". That is not buildable as stated: **auth-service has no proxy**.
It is reached through hand-written per-endpoint handlers, because the sign-in
routes set and clear cookies and cannot be a generic pipe — so the users source
has no `/api/...` path to loop back through.

Two further reasons, had one been available: a Next route fetching its own origin
needs an absolute origin it cannot reliably know behind a proxy, and it competes
with itself for the worker pool it is running in; and the proxy carries an
ETag/`Vary`/`If-None-Match`/SSE-piping contract that is dead weight for a bare
authenticated `GET`.

What the two paths **do** share is the credential carry, which is now
`bearerHeader(await sessionToken())` in one place rather than three copies of a
cookie name and an empty-token branch.

### A source declares its own search and label members

Metadata cannot supply them. `linkSearchProperty`/`linkLabelProperty` are
properties of a _referring_ accessor — they say how the owner of a relation looks
up its target — and an entity has no member that says what it is called. So the
host that mounts the screens declares it, next to the route those results lead
to.

`defineRecordSearchSource` validates the declaration against
`describeEntityColumns` **at module load**, refusing a member that is absent, not
`filterable`, not a `string`, or (for the label) not `sortable`. This is
`assertSearchable`'s posture and it exists for the same reason: every one of
those failures is silent at both ends — the service answers `400`, and the caller
renders that as a group it could not reach, which reads as "there are no
products".

The `string` check is the non-obvious one. An enum member passes the `filterable`
test and is still permanently broken: a `like` reaches `coerceValue`, which
rejects a partial term, so every keystroke short of a whole value answers `400`.

⚠️ Throwing at module load fails the whole app at boot, not just search. That is
deliberate — a source silently missing from a palette is indistinguishable from a
permission the caller lacks — but the blast radius is wider than the picker's,
which fails only its own render.

### Nothing is ranked across groups

Groups come back in **declared source order**, and within a group in the
service's order under an explicit `sort=+<label>`. A relevance score across four
unrelated entities is unpredictable and reshuffles on every keystroke; a fixed
order is learnable. #112 reached the same conclusion independently.

The explicit sort is what makes "ranked" true rather than nearly true: the
services apply no default order, so without it results arrive in storage order
and shift as records are rewritten.

### A degraded source is named, never a missing group

`unavailable[]` carries `{ source, entity, reason, status? }`. This **deviates
from the issue**, which asked for a `400` to "surface as an empty group, not an
error". An empty group is a confident claim that nothing matched — which is not
something the server can say about a service it could not reach.

The `reason` vocabulary splits two things that must not be conflated:

| Not yours to see                                       | Could not be reached                                  |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `forbidden`, `noActiveOrganization`, `unauthenticated` | `timeout`, `network`, `invalidQuery`, `notFound`, `unexpected` |

The left column is the **normal** state for some callers: an operator holds no
membership, so every tenant-plane search answers `409` on every keystroke.
Rendering "we could not reach this" for the ordinary case teaches people to
ignore the warning that matters.

### The fan-out is `Promise.all` over a runner that never rejects

Isolation comes from a per-source `catch` producing a typed outcome, not from
`Promise.allSettled`. With such a runner, `allSettled`'s `rejected` arm is
unreachable — dead code that cannot be tested and that the 100% coverage gate
would have to be lied to about.

Each source carries `AbortSignal.timeout(1500)`, and because the calls are
concurrent that also bounds the whole request. One slow service costs one group
and one timeout of wall clock, not four.

### A floor on the term

Below two characters nothing is queried at all. A `like` becomes an unanchored,
case-insensitive `$regex`, which no index can serve — **this endpoint is a
collection scan by construction**. One character matches most of every collection
and is worth nothing to the person typing.

That cost is accepted, not hidden. When it starts to show, the remedy is a text
index or a projection per source — not a client-side index, which is the one
option this record forecloses permanently.

## Alternatives rejected

**A prefetched client index.** Fast and simple, and it makes a cross-tenant
result a matter of when rather than whether. Rejected outright; it is the reason
this is a fan-out.

**A search service with its own store.** Under [ADR 0020](0020-stores-and-slices.md)
that is a Store, which needs a writing Slice, an ingestion path from four other
slices, and a staleness contract. A large amount of machinery to avoid four
concurrent HTTP calls that answer in ~50 ms locally. Worth revisiting only if the
collection scan becomes the bottleneck it is not yet.

**Loopback through this app's own proxies.** See above — not buildable for the
users source, and worse for the other three.

**Ranking across groups.** Rejected with #112: clever, unpredictable, and it
takes away the one thing that makes a palette fast to use, which is knowing where
a result will be before it appears.

## Consequences

- The palette can search records without holding any, and a source that is slow,
  down, forbidden or out of tenant scope degrades to one named group.
- **auth-service had to be corrected first.** Its list route read `page`/`pageSize`
  and silently dropped `rsql`, so a search for a name would have returned the
  first page of every user, presented as matches — a wrong answer, not a `400`.
  It also answered a bare `{ items, total, request }` that `readEntityPageEnvelope`
  cannot read. Both are now the shape the other three services use, which also
  gave that route the `filterable` allowlist it had never had.
- Adding a searchable entity is a `defineRecordSearchSource` call in the shell
  that owns its screens, and nothing in the host.
- `Configuration` is excluded deliberately: `config:configuration:read` is
  operator-only, but the rows are settings including credentials, and a palette
  is a broad surface to put them on for a convenience nobody asked for.
  `DictionaryTerm` is excluded because the back office has no screen for it, so a
  result would have nowhere to go.
- The `entitlements` ceiling is not consulted here. It does not need to be: what
  a caller may read is decided by the service that answers, and an organization
  provisioned for nothing simply gets no rows.

## References

- [ADR 0022](0022-v1-marketplace-module-boundaries.md) — the boundaries that put
  these records in four services, and the non-grantable reference vocabulary.
- [ADR 0023](0023-service-to-service-tenant-crossing.md) — the one named tenant
  crossing, which this does not extend.
- [ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md) — the
  served-affordances endpoint, the other place a caller asks a service what it
  may do rather than deciding locally.
- [ADR 0033](0033-the-screen-taxonomy.md) — the screen types a result routes to.
