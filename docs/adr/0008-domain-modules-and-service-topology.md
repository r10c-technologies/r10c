# 8. Domain modules, storage ownership, and service topology

- Status: Accepted
- Date: 2026-08-01
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  clarifies that the superseded block covers the topology section only; the tag
  dimensions and forbidden couplings are live.
- Amended by: [ADR 0020](0020-stores-and-slices.md) — the "three plane-hosts"
  topology below is **superseded**: the axis is ownership (a **Slice** and the
  **Stores** it writes), not plane, because a slice may own stores in more than
  one plane. One writer per database, the three forbidden couplings, and the
  `shell:`/`host:` dimensions all stand.

## Context

The decomposition in [ADR 0005](0005-business-domain-decomposition.md) produces
eight business domains. The obvious next move is eight services — one per domain,
each owning its database. The usual justification is that a single writer per
database avoids concurrency errors.

That justification is wrong, and following it would cost a lot. Concurrency is
handled by the database: transactions, MVCC, unique constraints, optimistic
locking. `marketplace-admin-service` already runs multiple replicas writing the
same Mongo concurrently, and one more process changes nothing about that.

Meanwhile the stated plan is the opposite: build the domain packages and shells,
keep services few, and split as traffic grows. Eight services on day one means
eight deployments, readiness probes, pipelines and config rows, plus eight
network hops, for zero current traffic — and it breaks the `300N`/`310N` port
convention, which allocates indices to frontend/backend _pairs_.

## Decision

### Single-writer-per-database is a code property, not a process count

What one writer per database actually buys:

- **Schema ownership** — migrations have exactly one owner. This is what makes
  per-organization storage tractable.
- **Invariant ownership** — nobody bypasses a domain's rules with a raw write.
- **Substitutability** — one domain can move from Mongo to Postgres without a
  fleet audit.

All three are properties of _code structure_. None requires a separate process.

### Three forbidden couplings

These are what actually foreclose splitting later, so they are the rule:

1. A module must not read or write another domain's collections or tables.
2. A cross-domain entity link must resolve through the other domain's use-case
   port, never at the storage layer. (`makeMongoLinkResolver(db, [ProductBrand,
ProductCategory])` is fine — those are the same domain.)
3. A cross-domain write must go through the saga, never one database
   transaction.

Ban these and any domain becomes extractable into its own process on an
afternoon's notice.

### Topology: three plane-hosts, one writer per database

> **Superseded by [ADR 0020](0020-stores-and-slices.md).** Organizing hosts by
> plane breaks as soon as [ADR 0009](0009-catalog-authoring-and-publication.md)
> lands: publication makes `marketplace-admin` own the tenant `catalog` store
> _and_ the platform `published-catalog` projection, and no host can be "the
> tenant host" while owning a platform store. Plane is a property of the Store; a
> Slice may own stores in several planes. The table below is kept as the record
> of what was decided, not as current guidance — the live register is in
> [docs/\_shared/planes.md](../_shared/planes.md).
>
> **This blockquote supersedes this section only.** The rest of this record is
> live and enforced: single-writer-per-database, the three forbidden couplings,
> the `shell:` and `host:` tag dimensions (which still fail builds), and "the Next
> backend is composition, never data access" — restated as ownership by ADR 0020.
>
> Two later corrections to the table itself.
> [ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md) deleted
> `marketplace-service` for having no store, and
> [ADR 0022](0022-v1-marketplace-module-boundaries.md) rebuilt it on `:3100` once
> it had two — `catalog-reference` and `published-catalog`. Its return is not a
> return to plane-hosts: it is a slice that happens to own both its stores in one
> plane, which is a fact about those stores and not a rule about the host.

| Host                               | Plane / database  | Mounts                                                                    |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `marketplace-service` (3100)       | platform          | marketplace-catalog, order-management, payment-management                 |
| `marketplace-admin-service` (3101) | tenant            | product-configuration-management, stock-management, settlement-management |
| `auth-service` (3102)              | control           | authn, party-management, access-management                                |
| `transaction-manager` (3103)       | —                 | publication saga, cross-domain writes                                     |
| `config-service` (3190)            | control (its own) | configuration                                                             |

One writer per database — the guarantee that was wanted — with three hosts
instead of eight, and every domain independently extractable. Note
`marketplace-admin-service` is already a domain-owning service; it was simply
named after the app rather than the plane.

Splitting a domain out later is a new app that mounts one module. No domain code
moves.

### A `shell:` tag dimension, so a domain module can exist

`layer:shell` forbids same-layer edges, so a per-domain API module could not
import `shells-effect-service` for `requirePermission` and `makeServerLayer`.

Add `shell:base` ‹ `shell:domain`, mirroring the existing `entifix:*` and
`business:*` intra-layer ordering. `shells-effect-service`,
`shells-next-common` and `shells-next-i18n` are `shell:base`; the domain shells
are `shell:domain`.

Rejected: pushing domain modules down to `layer:implementation` and moving the
route/auth primitives out of `shells-effect-service`. Purer layering, much larger
refactor of the service base, no different outcome.

Side effect, not acted on here: this also makes it legal for
`shells-next-system-management` to import `shells-next-common` instead of
carrying duplicate REST adapters. That duplication was forced by the old
constraint; removing it is a separate change.

### A `host:` tag dimension, so a Next app cannot reach a datastore

Apps are `layer:app`, the top layer, so nothing currently stops
`marketplace-app` from importing `makeMongoRepository` and `MongoDatabaseLayer`
and writing the database directly. That is the one hole in the ownership model,
and it is tag-fixable.

`entifix-ts-mongo-client`, `-sql-client`, `-redis-client` and `-amqp-client` gain
`runtime:datastore`. Next apps are `host:next`, Effect services `host:effect`,
and:

```js
{ sourceTag: 'host:next', notDependOnLibsWithTags: ['runtime:datastore'] }
```

Verified safe: no Next app depends on those four today. `jwt-client`, used by
marketplace-admin-app for cookie minting, is untouched.

### The Next backend is composition, never data access

Legitimate and already half-built: server components fetching per locale, route
handlers minting cookies, `createRefreshRoute`, `createConfigRoute`, the
same-origin proxy with `rewriteServiceDomains`.

Page-level aggregation across domains belongs in the React Server Component, not
in a service. It keeps services single-domain, avoids service-to-service chatter,
and is cache-friendly under ISR. What a Next app must never do is bind a
repository to a datastore client — which the tag rule above now enforces.

## Consequences

- **`nx graph` gains two dimensions to reason about.** The boundary rule ANDs
  every constraint whose `sourceTag` a project carries, so six dimensions
  compose; the header comment in `eslint.config.mjs` is the canonical list and
  must be updated with them.
- **The new rules are unproven until one is seen to fail.** Verification includes
  temporarily adding a datastore client to `marketplace-app` and confirming
  `nx lint` rejects it.
- **`marketplace-service` gains a purpose but not yet a router.** It is named as
  the platform-plane host here; wiring it is deferred until platform-plane
  entities exist.
- **A domain module cannot be created usefully yet.** `shells-effect-<domain>`
  packages need entities to mount. The dimension lands now, the modules follow —
  the dimension is the part that is expensive to retrofit, because it changes how
  every shell is tagged.
- **Cross-domain reads cost a call, not a join.** That is the intended price. A
  page needing three domains does three fetches from the RSC rather than one join
  in a service.

## Follow-ups (deliberately out of scope)

- `shells-effect-<domain>` modules.
- Giving `marketplace-service` a real router.
- De-duplicating `shells-next-system-management`'s REST adapters now that a
  shell-to-shell edge is legal.
- Extracting any domain into its own process — no traffic justifies it.
