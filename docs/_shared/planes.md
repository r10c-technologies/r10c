Business data lives in one of **three planes**, and which plane an entity belongs
to is part of its definition, not a deployment detail. See
[BUSINESS-ARCHITECTURE.md](../BUSINESS-ARCHITECTURE.md) and
[ADR 0006](../adr/0006-multitenancy-planes-and-tenant-storage.md).

| Plane        | Storage                                 | Holds                                                                                   |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **control**  | one shared database                     | Organization, Individual, Membership, Role, Entitlement, users, sessions, configuration |
| **platform** | one shared database                     | published marketplace catalog, buyer carts and orders                                   |
| **tenant**   | **one Mongo database per organization** | vendor-authored offerings, cost, pricing rules, stock                                   |

**Choosing a plane** — ask who may read it: everyone, including anonymous
storefront traffic → `platform`; exactly one organization → `tenant`; the
platform itself, or the record that makes an organization exist → `control`. An
entity that wants two planes is usually two entities — a tenant-authored record
and a published projection of it.

Six rules follow, and they are enforced by review, not by the compiler:

- **Entities are organization-agnostic.** No `organizationId` member, no tenant
  filter. Isolation is _which database handle the request resolves to_ — which is
  why no query can leak by omission. A discriminator column makes every missing
  filter a silent breach.
- **The tenant handle is request-level, never a `Layer`.** `MongoDatabaseLayer`'s
  boot-time `Layer.scoped` _is_ the connection pool; the per-organization handle
  is `client.db(...)` resolved inside the request from the session's
  `activeOrganizationId`. A `Layer` per request rebuilds the pool per request.
- **One writer per database**, and the three couplings that would foreclose
  splitting a domain out later: a module must not read another domain's
  collections; a cross-domain link resolves through the other domain's use-case
  port, never at the storage layer; a cross-domain write goes through the saga,
  never one transaction.
- **A quantity is never read-modify-written.** Absolute-value writes lose updates
  inside a single process. Use `$inc` / `SET qty = qty + $1` over an append-only
  movement ledger, and reserve stock with a _conditional_ atomic write rather
  than taking a distributed lock per decrement
  ([ADR 0010](../adr/0010-stock-ledger-reservations-and-concurrency.md)).
- **A Next app never binds a repository to a datastore client.** The Next backend
  is composition — cookies, proxying, RSC aggregation — never data access. The
  `host:next` / `runtime:datastore` boundary rule fails the build on a violation.
- **Published data is eventually consistent, on purpose.** The storefront's
  availability badge is a hint; the checkout reservation is the truth. Do not fix
  the staleness with a synchronous tenant-plane call from a prerendered page.
