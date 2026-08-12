# 11. Organization provisioning, migrations, and per-tenant seeding

- Status: Accepted
- Date: 2026-08-01
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  an organization has **two** tenant databases, so provisioning and migration fan
  out over stores × organizations.

## Context

[ADR 0006](0006-multitenancy-planes-and-tenant-storage.md) puts each
organization's data in its own Mongo database. That raises operational questions
which are cheap to answer now and expensive to answer after there are tenants:
who creates the storage, what runs a migration across N of them, and what a
local `dev:reset` is supposed to wipe.

The local seed adds a specific trap. `apps/config-service/src/db.ts` seeds with
`INSERT … ON CONFLICT (service, group_name, key) DO NOTHING`, and the comment
above it is explicit that this is _not_ a one-shot guard: a new key added to
`SEED_ROWS` lands on the next boot. That property is what makes editing a value
through the operator CRUD safe. It also means the reverse is true, and it is the
part that surprises people.

## Decision

### Provisioning is a registry record plus a naming convention

Creating an `Organization` writes the control-plane record and nothing else.
Mongo creates a database lazily on first write, so a tenant database costs
nothing until it holds something, and there is no `CREATE DATABASE` step to fail
halfway.

A tenant database name is `${prefix}${organizationId}`, with the prefix resolved
from config-service. The organization id is the only input, so a name is always
derivable and never stored twice.

**There is one prefix per store, not one per organization.** An organization has
two tenant databases — `tenant_<organizationId>` for the `catalog` store and
`stock_<organizationId>` for `stock` — because they are two stores with two
writing slices ([ADR 0022](0022-v1-marketplace-module-boundaries.md)). Both are
still lazily created and still cost nothing until written, so provisioning is
unchanged in substance: a registry record plus a naming convention, now applied
once per store.

(Postgres would need a real `CREATE SCHEMA` step. That is part of
[ADR 0013](0013-tenant-storage-on-postgres.md), not this record.)

### `Entitlement` is the provisioning record

Which business domains an organization may use is data on the organization, not a
deployment fact. It is also the second authorization ceiling
([ADR 0007](0007-access-model-planes-roles-entitlements.md)), so provisioning and
authorization read the same list, and a domain name means the same thing in both
([ADR 0005](0005-business-domain-decomposition.md)).

### Migrations and seeds fan out; the control plane does not

There are two distinct jobs and they must not be confused:

- **Control-plane migration** — runs once, on the shared database, at service
  boot. This is what exists today.
- **Tenant migration** — enumerates organizations from the control plane and runs
  per tenant. It must be idempotent per tenant and resumable, because it will
  fail partway at some tenant count.

  The fan-out is over **stores × organizations**, not organizations: each tenant
  store is migrated by the slice that owns it, and a slice must not migrate a
  store it does not write. That keeps the one-writer rule intact for the one
  operation most tempted to break it — a migration runner with credentials for
  everything is the easiest way to end up with two writers.

A tenant that is created _after_ a migration ran must still get it, so
provisioning applies the current migration set to the new tenant rather than
assuming boot-time migration covered it.

### The `DO NOTHING` trap, written down

Adding a **new** seed key is safe and self-healing: it lands on the next boot
with no reset.

Changing the **value** of an existing seed key does nothing to any database that
already has that row. A developer whose local install predates the change keeps
the old value silently, and the only correction is `pnpm run <app>:dev:reset`,
which wipes the namespace, PVs and hostPaths so services re-seed on boot.

This is not a defect — it is what makes the operator CRUD's edits survive a
restart. It is recorded because "the seed says X but my machine does Y" is
otherwise a long afternoon.

### Local reset already covers tenant databases

Db-per-organization lives on the same Mongo deployment and PVC, and
`infra/local/reset.sh` wipes the namespace, PVs and hostPaths. So it wipes tenant
databases too, and no infra manifest or reset script change is needed.

Each app gets its own `<app>:dev` / `<app>:dev:reset` script rather than
borrowing the admin app's, so the reset path is reachable from whichever app a
developer is working on.

## Consequences

- **A seeded demo organization is real isolation, not a fixture.** Its catalog is
  physically in its own database, and the check that proves it is a `mongosh`
  look confirming the collections are in the tenant database and absent from the
  shared one.
- **Tenant count is now an operational number.** Migration time, backup time and
  reconciliation time all scale with it. Fine at tens, needs batching at
  thousands.
- **Backups are per-database.** Restoring one tenant does not disturb another,
  which is a genuine benefit of this model, but backup tooling must enumerate.
- **Offboarding is a deletion of one database**, which makes data-deletion
  requests tractable and makes accidental deletion catastrophic. Both follow from
  the same property.
- **Provisioning is not yet a use-case.** The demo organization is seeded; a real
  onboarding flow is a follow-up.

## Follow-ups (deliberately out of scope)

- The tenant migration runner and its resumability.
- Organization onboarding and offboarding flows, including data export.
- Postgres schema provisioning
  ([ADR 0013](0013-tenant-storage-on-postgres.md)).
- Per-tenant backup scheduling and restore tooling.
