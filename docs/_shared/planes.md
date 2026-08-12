Business data lives in a **Store**, and a Store belongs to a **Slice**. Those two
nouns are the vocabulary for data ownership and for physical split; they are
defined in [ADR 0020](../adr/0020-stores-and-slices.md), and everything below is
their operative form.

> A **Store** is a named persistence boundary with exactly one writing slice, one
> plane, and a stable identity independent of the engine that backs it.
>
> A **Slice** is the unit that owns Stores and is the unit of physical split. It
> holds one or more domains, owns zero or more stores, and is realized as one or
> more Kubernetes deployments.

```
Domain  →  Store  →  Slice  →  Deployment
```

A domain's entities live in exactly one Store; a Store is owned by exactly one
Slice. **`engine` is not part of a Store's identity** — Mongo, Postgres and Redis
are deployment facts, so one engine instance may host many Stores, but a Store
may never span engines. A Store's name is not its database name: `catalog` is
physically `tenant_<organizationId>`.

## The store register

**This table is a mirror.** The register that actually holds is `tools/slices/`,
whose `slices.spec.ts` checks the three invariants against the source tree and
**fails the build** when they drift. Edit a `*.slice.ts` first; the table follows.

| Store               | Plane   | Owner slice         | Co-deployed with | Hosts                                                         | Partitioning     | Truth            |
| ------------------- | ------- | ------------------- | ---------------- | ------------------------------------------------------------- | ---------------- | ---------------- |
| `auth`              | control | `auth`              | —                | `authn` **+** `party-management` **+** `access-management` ⚠️ | single           | system-of-record |
| `session`           | control | `auth`              | —                | — (session records, no entities)                              | single           | system-of-record |
| `catalog`           | tenant  | `marketplace-admin` | —                | `product-configuration-management`                            | per-organization | system-of-record |
| `saga-coordination` | control | `marketplace-admin` | —                | — (locks + sequences, no entities)                            | single           | system-of-record |
| `configuration`     | control | `config`            | —                | `config`                                                      | single           | system-of-record |
| `saga`              | control | `transaction`       | —                | —                                                             | single           | system-of-record |

⚠️ `auth` hosting three domains is a **declared binding**: a `UserIdentity`, the
`Individual` behind it and the `Membership` granting it a role are written in the
same breath at sign-in and at provisioning, so separating them is a data
migration rather than a refactor. Accepted deliberately, not by accident.

**Co-deployed with** is the column that keeps consolidation honest. Two slices
sharing one deployment is _reversible_ — ownership does not move, only the
process does, and splitting back out is a matter of pointing a declaration's
`deployments` at a new app. Two domains sharing one **store** is not. Keeping the
two facts in separate columns is what stops a cheap decision being mistaken for a
binding one.

## The three planes

A plane is a property of the **Store** — it answers _who may read it_. An
entity's plane is derived from the store that hosts it, so two entities in one
store can never disagree about theirs.

| Plane        | Storage                                 | Holds                                                                                   |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **control**  | one shared database                     | Organization, Individual, Membership, Role, Entitlement, users, sessions, configuration |
| **platform** | one shared database                     | published marketplace catalog, buyer carts and orders                                   |
| **tenant**   | **one Mongo database per organization** | vendor-authored offerings, cost, pricing rules, stock                                   |

**Choosing a plane** — ask who may read it: everyone, including anonymous
storefront traffic → `platform`; exactly one organization → `tenant`; the
platform itself, or the record that makes an organization exist → `control`. An
entity that wants two planes is usually two entities — a tenant-authored record
and a published projection of it, which is a second Store carrying
`truth: projection-of:<store>`.

## What is not a Store

A **cache** (derivable and droppable), a **transport** (RabbitMQ — messages in
flight, not state at rest; the saga's `transactions` collection _is_ a store, the
exchange is not), and a **foreign system** (Zitadel's Postgres — it has an owner,
and the owner is not us).

## The rules that follow

The first three are enforced by `pnpm nx test @r10c/slices`, the last by the
boundary rule; the rest are review:

- **A Slice writes only the Stores it owns.** This is the old "one writer per
  database", now attached to a named thing. The three couplings that would
  foreclose splitting a domain out later: a module must not read another domain's
  collections; a cross-domain link resolves through the other domain's use-case
  port, never at the storage layer; a cross-domain write goes through the saga,
  never one transaction.
- **Two domains sharing a Store are permanently co-deployed.** Not forbidden, but
  a binding decision — record it in the register above, with its cost.
- **Entities are organization-agnostic.** No `organizationId` member, no tenant
  filter. Isolation is _which database handle the request resolves to_ — which is
  why no query can leak by omission. A discriminator column makes every missing
  filter a silent breach.
- **The tenant handle is request-level, never a `Layer`.** `MongoClientLayer`'s
  boot-time `Layer.scoped` _is_ the connection pool; the per-organization handle
  is `client.db(...)` resolved inside the request from the session's
  `activeOrganizationId`. A `Layer` per request rebuilds the pool per request.
  A slice whose handles are **all** per-request must open `MongoClientLayer`, not
  `MongoDatabaseLayer` — naming a database at boot that nothing ever writes puts
  a phantom store in the register, and the readiness probe does not need one
  (it pings `admin`).
- **A quantity is never read-modify-written.** Absolute-value writes lose updates
  inside a single process. Use `$inc` / `SET qty = qty + $1` over an append-only
  movement ledger, and reserve stock with a _conditional_ atomic write rather
  than taking a distributed lock per decrement
  ([ADR 0010](../adr/0010-stock-ledger-reservations-and-concurrency.md)).
- **Published data is eventually consistent, on purpose.** The storefront's
  availability badge is a hint; the checkout reservation is the truth. Do not fix
  the staleness with a synchronous tenant-plane call from a prerendered page.
- **A Next app belongs to no Slice, because it owns no Store.** The Next backend
  is composition — cookies, proxying, RSC aggregation — never data access. The
  `host:next` / `runtime:datastore` boundary rule fails the build on a violation.
