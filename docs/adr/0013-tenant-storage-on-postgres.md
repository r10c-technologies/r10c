# 13. Tenant storage on Postgres: schema per organization, one shared pool

- Status: Proposed
- Date: 2026-08-01

## Trigger

The first tenant-plane domain backed by Postgres. Today every tenant-plane domain
is on Mongo and config-service is control plane, so implementing this now would
be code with no caller.

## Context

[ADR 0006](0006-multitenancy-planes-and-tenant-storage.md) establishes ambient
tenancy behind a `TenantDatabaseResolver` port and ships the Mongo adapter, where
isolation is nearly free: one `MongoClient`, one pool, and `client.db(name)` is a
handle rather than a connection.

Postgres has no equivalent. A `PgClient` owns a **pool**, so the obvious
translation of "database per tenant" — a pool per tenant — has arithmetic behind
it that must be checked before it is chosen.

## Decision

### Schema per organization, on one shared pool

One `PgClient`. The resolver sets the search path per unit of work:

```sql
SET LOCAL search_path TO tenant_<organizationId>
```

`SET LOCAL` scopes to the surrounding transaction, so it cannot leak into the
next checkout of the same pooled connection. Every tenant-plane statement
therefore runs inside a transaction — which is the rule this decision imposes,
and the one thing that makes it safe.

Tables are physically separate per tenant, so the leak-proof property of ADR 0006
holds: there is no discriminator column, and no query can leak by omission.

### Why not a pool per organization

The connection math kills it. Pools multiply by replicas:

> 100 organizations × 3 service replicas × 10 connections = 3,000 connections

against a server whose default `max_connections` is 100. Even generously tuned,
this fails somewhere in the low hundreds of tenants, and it fails as a
production outage rather than as a slow query.

It could be rescued with a lazily-built, LRU-evicting pool cache plus PgBouncer.
That is a real design and it is strictly more machinery for isolation the schema
approach already provides.

### Why not database per organization

Stronger isolation, same pool problem, plus cross-schema operations become
cross-database ones, and a migration runner must connect N times rather than
`SET search_path` N times. Held in reserve for the tiering case below.

### Tiering stays available, because the seam is a port

`TenantDatabaseResolver` is resolved per request, so a large or regulated tenant
can be given a dedicated database and its own pool while everyone else shares the
schema pool. That becomes configuration and an adapter, not a call-site change —
which is the reason ADR 0006 made it a port rather than a helper.

### Provisioning gains a real step

Unlike Mongo, a schema must exist before a write: `CREATE SCHEMA IF NOT EXISTS`
plus the current migration set, run when the organization is created
([ADR 0011](0011-organization-provisioning-and-migrations.md)).

## Consequences

- **Every tenant-plane Postgres statement must be inside a transaction.**
  `SET LOCAL` outside one silently applies to nothing and the statement reads the
  default search path — a cross-tenant read that raises no error. This is the
  sharp edge of this design and needs a test that asserts it, not a comment.
- **Migrations fan out per schema**, sharing the runner from ADR 0011.
- **`pg_dump --schema` gives per-tenant backup and restore** without extra
  tooling.
- **Connection count stays flat** as tenants grow; it scales with replicas only.
- **The Mongo and Postgres adapters differ in shape** — a handle versus a session
  setting — and that asymmetry is contained inside the port, which is what the
  port is for.

## Follow-ups (deliberately out of scope)

- The adapter itself, until a tenant-plane Postgres domain exists.
- PgBouncer, and dedicated pools for tiered tenants.
- Cross-schema reporting, which is a projection and not a query
  ([ADR 0012](0012-operator-cross-tenant-access.md)).
