# 6. Multitenancy: three planes, ambient tenancy, storage per organization

- Status: Accepted
- Date: 2026-08-01
- Amended by: [ADR 0020](0020-stores-and-slices.md) — a plane is a property of
  the **Store**, so an entity's plane is derived from the store that hosts it
  rather than declared on the entity. Everything else here stands.

## Context

The platform is single-tenant today. The target is SaaS: organizations subscribe
to provisioned applications, and their data must be separated — not merely
filtered.

Two things make this urgent rather than deferrable. Adding tenant ownership to
entities _after_ orders, stock movements and settlement records exist is a data
migration across every collection plus an audit of every query. And the entity
framework's serializer keys a record by `alias ?? name` in both directions, so an
entity's serialized form already _is_ its stored row — meaning the choice of how
tenancy is represented is a choice about the entity model itself, not about a
repository detail.

[ADR 0002](0002-authorization-roles-and-abac.md) listed "tenant scoping" as a
follow-up reachable through the existing `PolicyRequest` shape. This ADR takes
that up and lands somewhere different: tenancy turns out not to be an
authorization decision at all.

## Decision

### Three planes

| Plane        | Storage                                 | Holds                                                                                   |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **Control**  | one shared database                     | Organization, Individual, Membership, Role, Entitlement, users, sessions, configuration |
| **Platform** | one shared database                     | published marketplace catalog, buyer carts and orders                                   |
| **Tenant**   | **one Mongo database per organization** | vendor-authored offerings, cost, pricing rules, stock                                   |

Which plane an entity belongs to is part of its definition, not a deployment
detail. The rule for deciding: readable by anyone including anonymous storefront
traffic → platform; readable by exactly one organization → tenant; the platform
itself, or the record that makes an organization exist → control.

An entity that seems to want two planes is usually two entities — a
tenant-authored record and a published projection. That is the catalog's shape
([ADR 0009](0009-catalog-authoring-and-publication.md)).

### Entities are organization-agnostic

No `organizationId` member, no tenant filter, no `WHERE organization_id = ?`.

Isolation is _which database handle the request resolves to_. The decisive
property: **no query can leak by omission**, because there is no column to
forget. The discriminator-column alternative makes every missing filter a silent
breach, and the one thing guaranteed about a filter that must be written in
hundreds of places is that it will be missed in one.

This also keeps the entity model honest — a vendor's `Product` is just a
`Product`, and the same use-case runs against a tenant database, a test double,
or a future single-tenant deployment with no conditional.

### Tenancy is ambient, resolved from the session

A user signs in, the platform resolves the organization they are acting for, and
every subsequent request routes to that organization's storage.

Mechanically: `activeOrganizationId` rides in the session record and in
`TokenClaims` — whose index signature already reserved room for it, commented
_"Room for a few extra stable claims (e.g. tenant/org)"_. `Principal` gains
`organizationId` as a **first-class field, not inside `attributes`**:
`attributes` are ABAC decision inputs, the organization is a storage routing key,
and a wrong attribute produces a wrong decision while a wrong organization
produces a cross-tenant leak. Different blast radius, different field.

A user may belong to several organizations, so the organization is a property of
the **session**, not of the user. Switching re-mints the token. Modelling it as a
user property would have been simpler and would have made a person serving two
vendors keep two accounts.

### The tenant handle is a request-level Effect, never a `Layer`

`MongoDatabaseLayer` keeps its boot-time `Layer.scoped` — that _is_ the
connection pool, acquired once and released on shutdown. The per-organization
handle is resolved **inside the request**, from one `MongoClient`:
`client.db(\`${prefix}${organizationId}\`)`. A `Db` handle is not a connection.

A `Layer` per request would rebuild the pool per request. This is the single
mistake most likely to be made here, so it is stated as a rule rather than left
to be inferred.

The seam is a `TenantDatabaseResolver` port in `entifix-ts-business` with a Mongo
adapter in `entifix-ts-mongo-client`, so the strategy is swappable per datastore
and per tenant tier without touching a call site.

### Mongo db-per-org now; Postgres schema-per-org designed, not yet exercised

Mongo is nearly free: one `MongoClient`, one pool, N logical databases, and Mongo
creates a database lazily on first write — so "provisioning" is a registry record
plus a naming convention.

Postgres is where physical separation costs something, and the intended shape is
**schema-per-organization on one shared pool** (`SET LOCAL search_path` inside the
transaction). It is **not implemented**, because no tenant-plane domain is backed
by Postgres today — config-service is control plane. Shipping it would be code
with no caller. The design and the connection math that rules out
pool-per-organization are recorded in
[ADR 0013](0013-tenant-storage-on-postgres.md).

### Public storefront traffic resolves no tenant

The storefront is **platform-scope**. It is public, prerendered and read-heavy,
and has no session to resolve an organization from. Vendor identity is a `Party`
relation on the published offering, not a storage boundary.

Rejected: subdomain- or path-based tenant resolution for public traffic. Both
work, both are real designs, and both would have made every storefront page
tenant-scoped — multiplying the static matrix and putting a resolution step in
front of ISR — to model something that is not actually per-tenant. A marketplace
storefront is one shop with many sellers.

### Readiness probes the control plane only

A readiness check that walked every tenant database would be O(N) and would turn
one tenant's outage into a fleet-wide `degraded`. Probes stay on the control
plane, matching the existing rule that liveness never checks a dependency.

## Consequences

- **Swapping the catalog to tenant storage is a one-line change per route.**
  `apps/marketplace-admin-service/src/routes.ts` already resolves the database
  _inside_ each handler (`const db = yield* MongoDatabaseTag`) and provides
  `EntityRepositoryTag` per request. Replacing that `yield*` with the tenant
  handle touches no use-case, entity, adapter, filter translator or envelope.
  That is the design's central claim and the reason this shape was chosen.
- **Every authenticated route now depends on the session carrying an
  organization.** e2e fixtures that mint sessions (`seedSession` in
  `entifix-ts-testing-e2e`) must include the claim, or tenant-plane routes
  resolve nothing.
- **An operator has no tenant scope.** That is correct and it means operators
  cannot read tenant data until the audited crossing exists
  ([ADR 0012](0012-operator-cross-tenant-access.md)). Until then the tenant-plane
  screens are vendor-only, and an operator sees an explicit "select an
  organization" state rather than a silent empty list.
- **Backups, migrations and seeding fan out over N databases.** Covered by
  [ADR 0011](0011-organization-provisioning-and-migrations.md).
- **No infra manifest changes.** Db-per-organization lives on the same Mongo
  deployment and PVC, so `infra/local/mongodb` is untouched, and
  `*:dev:reset` already wipes PVs and hostPaths and therefore wipes tenant
  databases too.
- **A cross-organization query is impossible by construction.** Reporting across
  tenants — an operator dashboard, platform analytics — cannot be a query and
  must be a projection into the platform or control plane. This is a real
  constraint, and it is the price of the leak-proof property above.

## Follow-ups (deliberately out of scope)

- Postgres schema-per-organization ([ADR 0013](0013-tenant-storage-on-postgres.md)).
- The operator's act-as-organization crossing
  ([ADR 0012](0012-operator-cross-tenant-access.md)).
- Per-tenant encryption keys, data residency, and tenant-tiered storage
  (dedicated database or cluster for large or regulated tenants) — all reachable
  through the `TenantDatabaseResolver` port without a call-site change.
