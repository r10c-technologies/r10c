# 9. Catalog authoring in the tenant plane, publication into a platform read model

- Status: Proposed
- Date: 2026-08-01
- Amended by: [ADR 0020](0020-stores-and-slices.md) — "two catalogs, one
  projection" is two **Stores**: `catalog` (tenant, system-of-record) and
  `published-catalog` (platform, `truth: projection-of:catalog`).

## Trigger

The first `ProductOffering` entity, or the first storefront page that must list
products from more than one vendor. Whichever comes first promotes this record to
Accepted.

## Context

Two decisions already made collide, and this record resolves the collision before
the entities land.

Vendors author their catalogs in **tenant** storage — one database per
organization ([ADR 0006](0006-multitenancy-planes-and-tenant-storage.md)). The
storefront is **platform**-scope: public, prerendered, read-heavy, with no
session and therefore no organization to resolve. A platform-plane reader cannot
read tenant storage, and giving it the ability would delete the isolation
property that made the plane split worth having.

So "the catalog" cannot be one thing.

## Decision

### Two catalogs, one projection

1. A vendor authors `ProductSpecification`, `ProductOffering` and
   `ProductOfferingPrice` in **its own** tenant storage
   (`product-configuration-management`).
2. **Publishing** projects the approved subset into the platform-scope
   `marketplace-catalog`, which is what the storefront queries.

The projection runs on the existing saga engine (`entifix-transactions` +
`transaction-manager`), which already has the accept/execute split, the
distributed lock, and compensation on failure.

Rejected: keeping the whole catalog in the platform plane and scoping only
vendor-private data (cost, pricing rules, stock). One catalog, no projection,
genuinely simpler — and it puts vendor catalog writes back on shared storage, so
isolation for the catalog specifically degrades to permission checks that can be
forgotten. The asymmetry would also be confusing: some vendor data isolated by
construction, some by discipline.

### A published record is a snapshot, not a reference

The projection copies rather than links: price, currency, terms, vendor identity,
title, media references, and the availability signal. It does not hold a pointer
into tenant storage.

Three reasons, in order of weight: a platform-plane reader **cannot** dereference
a tenant pointer without the isolation break this design exists to avoid; a buyer
must see the price that was published, not one edited mid-session; and the
storefront's read path becomes immune to a tenant's write load.

### Approval is a state on the tenant-side offering

`draft` → `pending-review` → `published` → `unpublished`. Publication is what
projects; unpublication removes the platform record. Republishing an already
published offering replaces the projection wholesale — the projection is derived
data and is never merged into.

Operator moderation reads the tenant-side state, which means it needs the audited
crossing from [ADR 0012](0012-operator-cross-tenant-access.md). Until that
exists, publication is vendor-initiated and unmoderated.

### Published data is eventually consistent, and that is correct

The storefront's availability badge is a **hint**. The checkout reservation is
the truth ([ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)). A
buyer may see "in stock" for something that just sold out, and will be told
clearly at checkout.

> **Trap.** Do not fix the staleness by having the storefront call a tenant-plane
> service. That puts a per-request round trip on a prerendered public path, ends
> ISR, and still returns a value that is stale by the time the buyer clicks. The
> cheap hint and the authoritative check are the right pair.

## Consequences

- **Two shapes to keep honest.** A tenant-side offering and a published record
  are different entities with different fields. The projection is the only writer
  of the platform-side record.
- **A projection can drift or be lost**, so it must be rebuildable from tenant
  storage on demand. A rebuild walks every organization, which is the fan-out
  problem of [ADR 0011](0011-organization-provisioning-and-migrations.md).
- **Search and category browse are platform-plane queries**, so they are fast and
  cacheable without touching a tenant.
- **A vendor's edit is not immediately visible**, and vendors will notice.
  Publication needs to report its own state back to the authoring UI.
- **`marketplace-service` becomes the platform-plane read host**, and this is the
  work that gives it a router.

## Follow-ups (deliberately out of scope)

- Scheduled publication and price-change effective dates.
- A search index as a second projection off the same events.
- Bulk publication and vendor catalog import.
