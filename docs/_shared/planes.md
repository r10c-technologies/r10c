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

**This table is generated**, and the register that holds is `tools/slices/`, whose
`slices.spec.ts` checks the three invariants against the source tree and **fails
the build** when they drift. Edit a `*.slice.ts`, run `node tools/sync-docs.mjs`,
and stage the result — editing between the markers fails the commit.

A store with no hosts holds records that are not `@entity()` classes (sessions,
locks, sequences). A ⚠️ on the hosts column marks a multi-domain store, which is
a **binding**: those domains are permanently co-deployed and the reason is
recorded on the declaration as `bindingReason`.

<!-- docs:begin store-register -->

| Store               | Plane    | Owner slice         | Slice status | Co-deployed with    | Hosts                                                         | Partitioning     | Truth                   |
| ------------------- | -------- | ------------------- | ------------ | ------------------- | ------------------------------------------------------------- | ---------------- | ----------------------- |
| `auth`              | control  | `auth`              | active       | —                   | `authn` **+** `party-management` **+** `access-management` ⚠️ | single           | system-of-record        |
| `catalog-reference` | platform | `marketplace`       | active       | —                   | `catalog-reference`                                           | single           | system-of-record        |
| `catalog`           | tenant   | `marketplace-admin` | active       | `transaction`       | `product-configuration-management`                            | per-organization | system-of-record        |
| `configuration`     | control  | `config`            | active       | —                   | `config`                                                      | single           | system-of-record        |
| `order`             | platform | `order`             | **planned**  | —                   | `order-management`                                            | single           | system-of-record        |
| `payment`           | platform | `payment`           | **planned**  | —                   | `payment-management`                                          | single           | system-of-record        |
| `published-catalog` | platform | `marketplace`       | active       | —                   | `marketplace-catalog`                                         | single           | `projection-of:catalog` |
| `saga-coordination` | control  | `marketplace-admin` | active       | `transaction`       | —                                                             | single           | system-of-record        |
| `saga`              | control  | `transaction`       | active       | `marketplace-admin` | —                                                             | single           | system-of-record        |
| `session`           | control  | `auth`              | active       | —                   | —                                                             | single           | system-of-record        |
| `settlement`        | control  | `settlement`        | **planned**  | —                   | `settlement-management`                                       | single           | system-of-record        |
| `stock`             | tenant   | `stock`             | **planned**  | —                   | `stock-management`                                            | per-organization | system-of-record        |

<!-- docs:end store-register -->

A **planned** slice owns its stores and is held to all three invariants, but
declares **no deployment** — nothing writes those stores yet. Recording ownership
early is what catches a boundary error when the entities land instead of when
someone finally writes the service; declaring a deployment early would open a
handle to a store with no contents, which is the phantom store ADR 0020 struck
`marketplace_admin` for. A slice is promoted by the commit that writes its store.
The spec fails the build in both directions.

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

| Plane        | Storage                                                                   | Holds                                                                                                           |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **control**  | one shared database                                                       | Organization, Individual, Membership, Role, Entitlement, users, sessions, configuration, agreements and payouts |
| **platform** | one shared database                                                       | published catalog, the brand/category/dictionary vocabulary, buyer orders, payments                             |
| **tenant**   | **two Mongo databases per organization** — `tenant_<id>` and `stock_<id>` | vendor-authored offerings and specifications, pricing, stock                                                    |

**Two tenant databases, not one.** `catalog` and `stock` are the same plane and
the same partitioning but different stores with different writing slices, so they
get different handles — which makes one-writer a property of the connection
rather than of review. They must never transact together anyway; a cross-domain
write goes through the saga.

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
- **A cross-store reference is an id, never a `link`.** A `link` accessor invites
  the storage-layer join the first rule forbids, and the target is another
  slice's store. Resolve through the owning domain's use-case port.
- **A tenant handle can also come from an explicit `organizationId`** — but only
  with a service token _and_ a narrow route permission, and only for a caller
  acting on data whose owner it was handed rather than chosen
  ([ADR 0023](../adr/0023-service-to-service-tenant-crossing.md)). That is one
  named path with one caller (checkout reserving stock), not a general escape
  from the session rule above.
