# 22. The v1 marketplace: final domain, store and slice boundaries

- Status: Accepted
- Date: 2026-08-12
- Revised: 2026-08-17 by [ADR 0024](0024-selling-through-a-vendors-own-channel.md) —
  a twelfth domain (`sales-management`), a thirteenth store (`sales`) and a tenth
  slice join the register, so the inventory in Decision reads 12 / 29 / 13 / 10;
  `ProductOrder.buyerId` is no longer required.

## Context

[ADR 0020](0020-stores-and-slices.md) named the **Store** and the **Slice**;
[ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md) made the
invariants executable. Neither spent that vocabulary on the business it exists to
run.

Reading `packages/business/ts` showed how little of the map was real. Six domains
held entities — `authn`, `party-management`, `access-management`, `config`,
`product-configuration-management`, plus the storeless session and saga records.
The other five — `marketplace-catalog`, `order-management`, `payment-management`,
`settlement-management`, `stock-management` — were a single
`export const X_DOMAIN = '…'` each. Twelve entities in total.

A skeleton package is not neutral. It is a boundary nobody has decided yet, and
it gets decided by whoever writes its first entity. Three errors were already
latent, and each would have hardened the moment that happened:

- **`ProductBrand` and `ProductCategory` were tenant-owned.** Sony is not
  per-vendor. Two vendors each holding a private "Electronics" row means the
  storefront can never merge a browse tree or a facet — which is the definition
  of a marketplace, not a detail of one.
- **The `Product` entity was not SID's `Product`.** What existed was a catalog
  record; SID's `Product` is the instance a party owns after purchase, and it is
  what a subscription later becomes. [ADR 0005](0005-business-domain-decomposition.md)
  already recorded the fusion and deferred the split "with the catalog work".
  The name was spent on the wrong concept, and every month it stayed cost more
  to reclaim.
- **A platform-plane order must reserve tenant-plane stock, and no legal
  mechanism existed.** `TenantContextTag` documented itself as resolving _only_
  from the session's `activeOrganizationId`. A buyer's session carries none — the
  organization comes from the item. Every checkout in v1 walks into this.

This record fixes the map: which domains exist, which entities each owns, which
store hosts them, which slice writes it, and which of those slices run yet.

## Decision

Eleven domains, 28 entities, 12 stores, 9 slices, 6 deployments.

> **Revised 2026-08-17.** Twelve, 29, 13 and 10 as of
> [ADR 0024](0024-selling-through-a-vendors-own-channel.md), which adds the
> `sales-management` domain, the `SalesChannel` entity, the tenant-plane `sales`
> store and the planned `sales` slice. Deployments are unchanged at six: the new
> slice is `planned`, which is this record's own mechanism working as intended.

### Ownership is recorded before a process exists

`SliceDeclaration` gains `status: 'active' | 'planned'`.

A **planned** slice owns stores and hosts domains, and the three invariants apply
to it exactly as they do to an active one. That is the entire point: a boundary
error is caught when the entities land, not when someone finally writes the
service. What a planned slice may **not** do is claim a deployment.

That prohibition is the whole substance of the distinction. Opening a database
handle for a store nothing writes creates a persistence boundary with no contents
and no purpose — the defect ADR 0020 named when it struck `marketplace_admin`
from the register, and the reason ADR 0021 deleted `marketplace-service` rather
than keeping a placeholder to boot, probe and reason about. So a slice is
promoted to `active` **by the commit that writes its store**, never in advance.

Four of the nine slices are planned. The register is therefore the target
topology and the current one at the same time, and the difference is a field
rather than a comment.

### The store register

| Store               | Plane    | Owner slice         | Hosts                                                 | Partitioning     | Truth                   |
| ------------------- | -------- | ------------------- | ----------------------------------------------------- | ---------------- | ----------------------- |
| `auth`              | control  | `auth`              | `authn` + `party-management` + `access-management` ⚠️ | single           | system-of-record        |
| `session`           | control  | `auth`              | —                                                     | single           | system-of-record        |
| `configuration`     | control  | `config`            | `config`                                              | single           | system-of-record        |
| `catalog`           | tenant   | `marketplace-admin` | `product-configuration-management`                    | per-organization | system-of-record        |
| `saga-coordination` | control  | `marketplace-admin` | —                                                     | single           | system-of-record        |
| `saga`              | control  | `transaction`       | —                                                     | single           | system-of-record        |
| `catalog-reference` | platform | `marketplace`       | `catalog-reference`                                   | single           | system-of-record        |
| `published-catalog` | platform | `marketplace`       | `marketplace-catalog`                                 | single           | `projection-of:catalog` |
| `stock`             | tenant   | `stock`             | `stock-management`                                    | per-organization | system-of-record        |
| `order`             | platform | `order`             | `order-management`                                    | single           | system-of-record        |
| `payment`           | platform | `payment`           | `payment-management`                                  | single           | system-of-record        |
| `settlement`        | control  | `settlement`        | `settlement-management`                               | single           | system-of-record        |

Six new stores, and **no new binding**: `auth` remains the only multi-domain
store in the repository. Every domain added here owns its store alone, so ADR
0021's test — _can you name the one slice that writes each store, without reading
code?_ — is answerable for all six by reading one column.

### The slices

| Slice               | Status     | Stores                               | Deployment                        |
| ------------------- | ---------- | ------------------------------------ | --------------------------------- |
| `config`            | active     | configuration                        | config-service `:3190`            |
| `auth`              | active     | auth, session                        | auth-service `:3102`              |
| `marketplace-admin` | active     | catalog, saga-coordination           | marketplace-admin-service `:3101` |
| `transaction`       | active     | saga                                 | ↳ co-deployed there               |
| `marketplace`       | **active** | catalog-reference, published-catalog | **marketplace-service `:3100`**   |
| `stock`             | planned    | stock                                | — (target `:3108`)                |
| `order`             | planned    | order                                | — (target `:3105`)                |
| `payment`           | planned    | payment                              | — (target `:3106`)                |
| `settlement`        | planned    | settlement                           | — (target `:3107`)                |

`marketplace` owns a system-of-record store **and** a projection, both platform
plane. That is the shape ADR 0020 predicted when it retired "plane-hosts" as the
topology axis, now built rather than hypothesized.

`marketplace-service` returns to `:3100`, which ADR 0021 freed. It comes back
because `catalog-reference` has real contents on day one — not as a placeholder,
which is what 0021 deleted.

### 1. Brand, category and the dictionary are platform-plane reference data

`ProductBrand` and `ProductCategory` move out of
`product-configuration-management` into a new `catalog-reference` domain, joined
by `DictionaryTerm`.

> **The move is not a file move, and the boundary rule is why.**
> `ProductSpecification` declared typed `EntityLink<ProductBrand>` /
> `EntityLink<ProductCategory>`, resolved at the storage layer by
> `makeMongoLinkResolver` against the same tenant database. The `business:domain`
> tag may depend only on `business:policy`, `layer:entifix` and `layer:utils` —
> **never on another `business:domain`** — so the moment `ProductBrand` lives in
> `catalog-reference`, the typed link is an illegal edge and the build says so.
>
> So the members are plain `brandId` / `categoryId` strings, resolved through the
> owning domain's read path, which is what `_shared/planes.md` already required
> of a cross-domain reference. `loadProductsUCFactory` existed only to follow
> those links and was **deleted** rather than kept as a passthrough over
> `loadUCFactory`.
>
> Two consequences worth stating rather than discovering. The admin form's brand
> and category **pickers are gone** — they were `EntityLinkPicker`s over `link`
> accessors, and a picker that writes a scalar id is follow-up work; the
> `EntityLinkSource` port is framework-free, so restoring one is legal, not a
> dead end. And **nothing enforces the reference**: a cross-store foreign key is
> exactly the coupling the split removes, so a dangling id is a display gap
> rather than a corrupt record, and every consumer renders a fallback.

A marketplace has to **merge**. Per-vendor taxonomy makes a cross-vendor browse
tree impossible in principle, not just inconvenient: there is no correct way to
decide that vendor A's "Electronics" and vendor B's "Electronics" are the same
node, and a facet over free-form strings returns nothing useful. The same
argument [ADR 0014](0014-entity-specifications-and-the-characteristic-dictionary.md)
already made for characteristics — comparability comes from a platform-owned
vocabulary vendors resolve _to_ — applies unchanged to brand and category.

Rejected: keeping them tenant-owned and merging at read time. There is nothing to
merge on. Rejected: a platform taxonomy plus a private `VendorCategory` for
internal organization. Honest, and deferred rather than refused — it is two more
entities for a need no vendor has expressed.

**This domain is operator-owned and never entitlement-grantable.** An
organization is not "provisioned for" the platform's shared vocabulary. A tenant
role mintable against `catalog-reference` would let one vendor rewrite the browse
tree every other vendor is classified into, which is a privilege escalation the
`Entitlement` ceiling exists to prevent. This is the first domain to which the
ceiling of [ADR 0007](0007-access-model-planes-roles-entitlements.md) does not
apply, and the exception is recorded here rather than discovered later.

### 2. The `marketplace` slice writes the projection, not the slice that authored it

`marketplace-admin` emits `catalog.published`; `marketplace` consumes it and
writes `published-catalog`.

Both arrangements satisfy one-writer, so the choice is about what else it buys.
Having the **consumer** write it means the public read host never opens a
connection to tenant storage at all — the isolation property is structural rather
than a rule about which query a route makes. Having the **author** write it would
save an event hop and put a public-read store under the vendor-write service,
where storefront traffic and catalog authoring share a process.

The saga engine already has the accept/execute split, the lock and the
compensation, so the hop costs nothing new
([ADR 0009](0009-catalog-authoring-and-publication.md)).

### 3. Two tenant stores, two databases per organization

`catalog` is `tenant_<organizationId>`; `stock` is `stock_<organizationId>`.

> **Revised 2026-08-17.** Three, as of
> [ADR 0024](0024-selling-through-a-vendors-own-channel.md): `sales` is
> `sales_<organizationId>`. The reasoning below is unchanged and is what the
> third store was decided by.

They could share one database and differ only by collection. Separating them
makes one-writer-per-store a property of **which handle a request resolves to**
rather than of review — the same argument [ADR 0006](0006-multitenancy-planes-and-tenant-storage.md)
makes for tenancy itself, applied one level down. A bug cannot write the other
slice's collections if it never holds a handle that reaches them.

The usual objection — that two databases forbid a transaction across them — is
not a cost here. A cross-domain write is forbidden anyway: it goes through the
saga, never one transaction. The separation removes the temptation rather than
creating the constraint.

Cost: a second per-request handle resolver, and provisioning and tenant
migrations now fan out over **stores × organizations** rather than organizations
([ADR 0011](0011-organization-provisioning-and-migrations.md)).

### 4. `Product` becomes `ProductSpecification`, and SID's `Product` takes the name

The catalog record is renamed; the owned instance — what a party holds after an
order completes — takes `Product` in `order-management`.

Doing it now rather than "with the catalog work" as ADR 0005 deferred: the key
change moves a permission namespace, an i18n catalog key, a route path and a
tenant collection name at once, and every entity added afterwards makes that
sweep larger. There are ~25 call sites today.

The owned instance is an entity **inside the `order` store**, not a store of its
own. It is written in the same breath as the order that creates it, and a
separate store would be a second persistence boundary for one transaction's
worth of work. Including it at all — rather than letting orders be the only
record of what a buyer holds — is what makes a subscription later a recurring
`ProductOfferingPrice` instead of a new domain and a backfill.

### 5. One order, vendor-tagged lines

A basket spanning several vendors produces one `ProductOrder` whose `OrderItem`
lines each name a `vendorId`.

The buyer gets one receipt for one payment; settlement aggregates by the tag. The
alternative — an order per vendor under a shared basket id — makes settlement and
vendor fulfillment trivial and shows the buyer N orders and N statuses for a
single checkout.

Accepted cost, stated so it is not rediscovered as a bug: "orders for vendor X"
becomes a query into an embedded array rather than a top-level filter, so a
vendor-facing order list needs an index on the embedded path or a projection.
`OrderItem` is a **value**, not an entity — it has no identity apart from its
order.

### 6. `PartyRole` becomes an entity, and the token claim becomes derived

A party plays many roles over time and several at once. SID models `Customer` as
a subclass of `PartyRole` precisely so a party is never hard-wired as one thing,
and BUSINESS-ARCHITECTURE already names the case: an organization that is a
marketplace vendor _and_ a CRM customer.

`Individual.partyRole` — a single column — cannot express that, and it is the
live source today, read at `apps/auth-service/src/identity/session-scope.ts`.

The access-token claim is unchanged in every respect that matters: resolved once
at sign-in, re-signed unchanged on refresh, routing context and never a grant
([ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md)). What
changes is its **source**, from a column to a queryable record.

A party holding several roles needs a rule for which one the session gets, since
the claim is a single value that selects a storage plane. **Precedence by reach:
`operator` > `vendor` > `customer`.** Deterministic, needing no extra input.
Recorded cost: an operator who is also a buyer always gets an operator session,
so there is no way to act as a buyer while being staff. The alternative —
resolving the role from the membership the session opened under — is the better
long-run answer and is deferred until something needs it.

`Individual.partyRole` is **removed** in the same change. Leaving it beside the
entity would be two writers for one fact.

### 7. Payment is a port with a simulated adapter

PSP integration is out of v1 scope, but the slice is not deferred with it.
Without a payment there is no event that converts a stock reservation to a sale,
and settlement has no input at all — deferring the slice would leave orders
terminating at `placed` and reservations expiring on TTL forever.

So v1 lands the `Payment` record behind a `PaymentProviderTag` port with a
simulated adapter. Authorization and capture stay distinct states because that is
what a real provider distinguishes; collapsing them into `paid` now would make
the eventual adapter model something the domain cannot express.

### 8. `settlement` is a control-plane store

The one commerce domain whose store is not platform plane.

A plane answers _who may read it_. An `Agreement` — commission terms between the
platform and one vendor — is the platform's own record about a customer, the same
character as `Entitlement`, and nothing like a public catalog. ADR 0020 allows a
slice to own stores in more than one plane, so the neighbouring commerce stores
being platform plane is not an argument.

Commission is captured per sale as a `CommissionEntry` rather than computed at
payout time. Computing it later would read whatever the agreement says _then_, so
a rate change would silently rewrite history — the same class of bug as
referencing a price instead of capturing it.

### 9. The cart stays a cookie

Reservations do not need a server-side cart, and the storefront's first response
has to be correct without a round trip. A `Cart` entity would also add the only
anonymous write surface in the fleet, with the rate limiting and expiry sweep
that implies. Multi-device carts and abandoned-cart recovery are the price, and
they are not v1 features.

### 10. Operator moderation is not in v1

ADR 0012's `Crossing` is not built. Publication stays vendor-initiated and
unmoderated, which [ADR 0009](0009-catalog-authoring-and-publication.md) already
permits, and the `auth` store stays at three bound domains instead of four.

### 11. The service-to-service tenant crossing is its own record

Decision 12 of this iteration — how a platform-plane order reserves tenant-plane
stock — is [ADR 0023](0023-service-to-service-tenant-crossing.md). It is
security-bearing and it modifies a rule stated in ADR 0006, so it gets a record
rather than a section.

### An ADR's reasoning is immutable; its factual claims are not

This iteration falsifies statements in a dozen accepted records — that
`marketplace-service` is an empty stub, that the dictionary is owned by
`marketplace-catalog`, that a tenant is one database. `docs/adr/README.md` says
records are _"immutable once Accepted"_ and that a later decision _"is a new ADR
that supersedes it"_, which held literally would leave every one of those on file,
findable by grep and indistinguishable to a reader from a live rule.

The convention is therefore amended:

> An ADR's **reasoning** is immutable; its **factual claims** are not. A
> statement about how the system is arranged is corrected in place when it stops
> being true. A **decision** that no longer holds is still superseded by a new
> record, never edited away.

Three tiers. **Fix** — the record asserts something now false; corrected in
place. **Clarify** — the reasoning stands and the wording misleads; rewritten in
place. **Supersede** — the decision itself no longer holds; unchanged mechanism,
a blockquote pointing forward with the old text kept. Proposed records are
corrected freely, since they are not in effect; Accepted records carry a
`- Revised:` line so every edit is greppable.

**The cost, since this trades something real away.** Immutable records let you
reconstruct what people believed when they decided. Editing in place loses that,
and `- Revised:` lines plus git history are a weaker substitute than what the repo
had. It is a choice, not an upgrade. What it buys is that no record is quietly
wrong — which matters more here than in most repositories, because `CLAUDE.md`
instructs agents to read the relevant ADR before designing in an area.

## Consequences

- **Thirteen records are corrected**, listed with their tier in this iteration's
  work: 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015, 0020, 0021. Two are promoted from Proposed to Accepted because their own `## Trigger`
  fires — 0009 on the first `ProductOffering` entity, 0010 on the first
  `StockItem`. Three were checked and do **not** fire: 0014 (no offering carries
  a vendor-authored characteristic yet), 0013 (both tenant stores are Mongo),
  0012 (decision 10 above).
- **ADR 0006's isolation rule gains a second resolution path**, which is the most
  consequential edit in the set and the reason 0023 exists separately.
- **The register is the target topology and the current one.** Four planned
  slices mean `tools/slices/` describes stores no process opens — deliberately,
  and enforced: a planned slice declaring a deployment fails the build.
- **A new invariant starts from the package, not the entity.** Every
  `*_DOMAIN` constant under `packages/business/ts` must be claimed by exactly one
  slice. Invariant 1 scans `@entity()` and is therefore blind to a domain package
  that owns no entities yet — which was the state of all five skeletons, and
  exactly when a boundary gets decided by accident.
- **`catalog-reference` is the first non-entitlement-grantable domain**, so
  `Entitlement`'s "list of domain names" is no longer the complete vocabulary.
- **Provisioning and tenant migration fan out over stores × organizations.**
- **What is deliberately still absent**: entity properties beyond identity,
  use-cases, adapters, the catalog publisher, checkout, the storefront reading
  `published-catalog` (it stays on fixtures), and any UI for the six new domains.
  The map is the deliverable; the mechanisms are the next iteration.

## Follow-ups (deliberately out of scope)

- Restoring a brand/category **picker** over a scalar id field, which needs an
  `EntityLinkSource` fed by a marketplace-service adapter and a picker that
  writes an id rather than an `EntityLink`.
- Building the four planned slices, in the order the storefront needs them:
  `stock` and `order` together, then `payment`, then `settlement`.
- The catalog publisher — the `catalog.published` producer and its consumer.
- Resolving `partyRole` from the membership the session opened under, replacing
  the precedence rule in decision 6.
- A private `VendorCategory` beside the platform taxonomy, if a vendor ever asks.
