# Business architecture

Every iteration so far built the **platform**: the entity framework, the
layering, auth, i18n, observability, the transaction engine. This document adds
the other half — the **business** the platform exists to run.

It is the map, not the implementation. Most entities and use-cases land in
following iterations; what is fixed here is the vocabulary, the decomposition,
the data planes, and the rules that keep a domain extractable into its own
service later.

The decisions behind it:
[ADR 0005](adr/0005-business-domain-decomposition.md) ·
[ADR 0006](adr/0006-multitenancy-planes-and-tenant-storage.md) ·
[ADR 0007](adr/0007-access-model-planes-roles-entitlements.md) ·
[ADR 0008](adr/0008-domain-modules-and-service-topology.md) ·
[ADR 0011](adr/0011-organization-provisioning-and-migrations.md) ·
[ADR 0022](adr/0022-v1-marketplace-module-boundaries.md), which fixes the v1
boundaries — every domain, entity, store and slice below — and
[ADR 0023](adr/0023-service-to-service-tenant-crossing.md) for the one call that
crosses from the platform plane into a tenant's storage.

[0009](adr/0009-catalog-authoring-and-publication.md) (catalog publication) and
[0010](adr/0010-stock-ledger-reservations-and-concurrency.md) (the stock ledger)
are **Accepted** as of ADR 0022, which landed the entities their triggers named —
their decisions are in effect even though the publisher and the checkout are not
built yet. Still **Proposed**, and worth reading before designing in those areas:
[0012](adr/0012-operator-cross-tenant-access.md) (operator cross-tenant access),
[0013](adr/0013-tenant-storage-on-postgres.md) (tenant storage on Postgres) and
[0014](adr/0014-entity-specifications-and-the-characteristic-dictionary.md)
(vendor-authored specifications).

## The target, and the first stage

The long-run target is a multi-tenant SaaS ecosystem: organizations subscribe to
independently provisioned business applications — commerce today, CRM, ERP and
analytics later — that share one platform and one identity.

The first stage is a **marketplace**: many vendors sell their own products to
final users through one storefront. It is a first stage, not a scope limit —
every module is named and shaped so the next business model extends it rather
than replaces it. A subscription is a `ProductOffering` with a recurring price,
not a new catalog. A delivery integration is another kind of stock movement, not
a new inventory.

## Naming: TM Forum, borrowed not adopted

Domain names follow TM Forum's [Open Digital Architecture](https://www.tmforum.org/oda/)
(ODA) and its information model, the
[SID](https://www.tmforum.org/open-digital-architecture/information-framework-sid/),
where the vocabulary fits.

**Adopted**: the decomposition into business capabilities, the domain names, and
the entity vocabulary — `Party`, `PartyRole`, `ProductSpecification`,
`ProductOffering`, `ProductOfferingPrice`, `ProductOrder`.

**Not adopted**: TMF Open API conformance, the ODA Canvas, the canonical REST
payload shapes, certification. We are not a telco and have no interoperability
requirement to pay for that.

The payoff is a domain language that is already thought through, and already
unambiguous about distinctions most codebases collapse and then cannot separate
again — see the glossary.

Three deltas worth recording explicitly, because a reader who knows ODA will look
for them:

- **ODA is silent on multi-tenancy.** Tenant isolation is absent from the ODA
  component design guidelines. The plane model below is ours, and no ODA
  guidance contradicts or endorses it.
- **ODA is silent on data ownership.** A component's boundary is deliberately
  opaque — inside it the implementer picks any internal data store, and the
  guidelines name neither the store, nor its ownership, nor its relation to the
  SID entities the component manages. **Store** is therefore ours; **Slice** is
  our name for what ODA calls a Component, and its declaration borrows ODA's
  `exposedAPIs` / `dependantAPIs` / `publishedEvents` / `subscribedEvents`
  vocabulary ([ADR 0020](adr/0020-stores-and-slices.md)).
- **ODA's "Product Inventory" is not stock.** See the glossary entry.

## Glossary

The anti-drift artifact. Most of a domain model's cost is people meaning
different things by "product".

| Term                      | Meaning                                                                                                                                                                                                                                                                                                                                                 | Source        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Party**                 | A person or company known to the platform. Abstract: always an `Individual` or an `Organization`. Recorded before it plays any role.                                                                                                                                                                                                                    | SID           |
| **Individual**            | A `Party` that is a person.                                                                                                                                                                                                                                                                                                                             | SID           |
| **Organization**          | A `Party` that is a company. **The tenant**: the unit tenant storage is provisioned for.                                                                                                                                                                                                                                                                | SID           |
| **PartyRole**             | A role a `Party` plays — `vendor`, `customer`, `operator`. SID makes `Customer` a subclass of `PartyRole` precisely so a party is never hard-wired as one thing; a party plays many roles over time.                                                                                                                                                    | SID           |
| **Membership**            | A `Party`'s participation in an `Organization`, carrying the roles it holds there.                                                                                                                                                                                                                                                                      | ours          |
| **Entitlement**           | The set of business domains an `Organization` is provisioned for. The ceiling on what its tenant roles may grant.                                                                                                                                                                                                                                       | ours          |
| **ProductSpecification**  | What a thing _is_ — the facts common to every instance of it. Definitional, not commercial.                                                                                                                                                                                                                                                             | SID           |
| **EntitySpecification**   | A **vendor-authored, versioned** specification. Its released versions are immutable, and an instance pins the version it was written under.                                                                                                                                                                                                             | SID           |
| **Characteristic**        | One spec'd member: a code, a value type, and constraints. A `CharacteristicSpecification` defines it; a `CharacteristicValue` on an instance holds it.                                                                                                                                                                                                  | SID           |
| **DictionaryTerm**        | A platform-owned characteristic vocabulary entry — code, value set, unit. What makes a characteristic comparable across vendors, and therefore facetable.                                                                                                                                                                                               | ours          |
| **ProductOffering**       | The commercial packaging: what is orderable from a catalog, priced and termed.                                                                                                                                                                                                                                                                          | SID           |
| **ProductOfferingPrice**  | A price attached to an offering. Separable from the offering so one offering can be priced several ways.                                                                                                                                                                                                                                                | SID           |
| **PricingLogicAlgorithm** | An interface to a rating function, with some parameters bound and some gathered at rating time. SID deliberately models the _seam_, not the behaviour — which is exactly a port.                                                                                                                                                                        | SID           |
| **Product**               | An **instance** of an offering, owned or subscribed to by a party — what a buyer holds after checkout. **Not a catalog record.** The catalog record is `ProductSpecification`; the entity that used to be called `Product` was renamed for exactly this reason ([ADR 0022](adr/0022-v1-marketplace-module-boundaries.md)). Lives in `order-management`. | SID           |
| **ProductOrder**          | A party's request for one or more offerings.                                                                                                                                                                                                                                                                                                            | SID           |
| **StockItem**             | Physical availability of an offering for a vendor. A **materialized total**, not the truth — `StockMovement` is.                                                                                                                                                                                                                                        | ours          |
| **PublishedOffering**     | The storefront's **snapshot** of a vendor's offering, taken at publication. Copies price and vendor rather than linking, because a platform-plane reader cannot dereference a tenant pointer.                                                                                                                                                           | ours          |
| **SalesChannel**          | A route a vendor sells through — the storefront, a counter in their own shop, a phone line. Per-vendor, so it never merges the way a brand or a category has to.                                                                                                                                                                                        | SID           |
| **RelatedChannel**        | The channel copied onto a `ProductOrder`. TM Forum models an in-store sale as a channel on the same order rather than as a second kind of order, which is why a counter sale is a `ProductOrder` and no in-store equivalent exists.                                                                                                                     | SID           |
| **OrderItem**             | One line of a `ProductOrder`, tagged with the vendor that owes it. A **value**, not an entity — no identity apart from its order.                                                                                                                                                                                                                       | SID           |
| **CommissionEntry**       | One sale's commission, **captured when the sale happens**. Computing it at payout time would let a rate change silently rewrite history.                                                                                                                                                                                                                | ours          |
| **SettlementRun**         | One period's batch, folding commission entries into payouts. A record rather than a job invocation, so "the March run" stays answerable.                                                                                                                                                                                                                | ours          |
| **VendorPayout**          | What one vendor is owed for one `SettlementRun`. The fold of that vendor's commission entries — the same ledger-then-total shape `StockItem` has.                                                                                                                                                                                                       | ours          |
| **StockMovement**         | An append-only record of a quantity change (+receipt, −sale, +cancellation). The ledger `StockItem` totals.                                                                                                                                                                                                                                             | ours          |
| **Reservation**           | A time-limited hold on stock taken at checkout, converted to a sale on payment or released on expiry.                                                                                                                                                                                                                                                   | ours          |
| **Agreement**             | The contract between the platform and a vendor: commission, terms, obligations. Where commission rates live.                                                                                                                                                                                                                                            | ODA (TMFC039) |
| **Store**                 | A named persistence boundary with exactly one writing slice, one plane, and a stable identity independent of the engine that backs it. A domain's entities live in exactly one.                                                                                                                                                                         | ours          |
| **Slice**                 | The unit that owns Stores and the unit of physical split. Holds one or more domains, owns zero or more stores, is realized as one or more Kubernetes deployments. ODA would call it a Component.                                                                                                                                                        | ours          |
| **Plane**                 | Which storage boundary a **Store** lives behind: control, platform, or tenant. Answers _who may read it_. An entity's plane is derived from the store that hosts it.                                                                                                                                                                                    | ours          |
| **Tenant**                | An `Organization` together with the storage provisioned for it.                                                                                                                                                                                                                                                                                         | ours          |

## Personas

| Persona      | A tenant?                   | Data scope                                                  | Lifecycle               |
| ------------ | --------------------------- | ----------------------------------------------------------- | ----------------------- |
| **Buyer**    | No                          | own cart and orders                                         | self-registers          |
| **Vendor**   | **Yes — an `Organization`** | its own tenant storage only                                 | onboarded as a customer |
| **Operator** | No                          | control plane, and cross-tenant only by an audited crossing | platform staff          |

Which persona a session belongs to is carried explicitly, as the `partyRole`
claim on the access token — resolved once at sign-in from the person's
`Individual` record and never inferred from whether an organization happened to
resolve, because a buyer and an operator both hold none
([ADR 0015](adr/0015-asymmetric-access-tokens-and-the-party-role-claim.md)).

A persona is a **`PartyRole`**, not an entity type. Getting this backwards —
"vendor = Organization, buyer = Individual" — is the modelling mistake SID exists
to prevent: it forecloses a B2B buyer, a vendor purchasing from another vendor,
and an organization that is a marketplace vendor _and_ a CRM customer, which is
the whole point of the long-run ecosystem.

Vendor is a customer of the platform. Operator _is_ the platform: creates
organizations, approves catalogs, sets commission, runs settlement, resolves
disputes, reads the technical surfaces. The distinction is not organizational
tidiness — it is the tenancy boundary itself. A vendor is _defined_ by being
scoped to one tenant's storage; an operator's job is the work no single tenant
can see.

Vendor and operator share one back-office host (`back-office-app`, `:3001`) with
permission-gated navigation. Two personas, one app.

## Stores, slices, and data planes

Data ownership has two nouns, and everything else about topology follows from
them ([ADR 0020](adr/0020-stores-and-slices.md)):

```
Domain  →  Store  →  Slice  →  Deployment
```

> A **Store** is a named persistence boundary with exactly one writing slice, one
> plane, and a stable identity independent of the engine that backs it.
>
> A **Slice** is the unit that owns Stores and the unit of physical split. It
> holds one or more domains, owns zero or more stores, and is realized as zero or
> more deployments.

Four levels, each with exactly one job: a **domain** carries business meaning and
is the permission namespace; a **store** is a persistence boundary with one
writer; a **slice** is who that writer is and what can be split off; a
**deployment** is the Kubernetes object actually running.

### The three invariants

These are not guidance. `tools/slices/` declares the register in TypeScript and
`pnpm nx test @r10c/slices` **fails the build** on a violation.

1. **A domain's entities live in exactly one Store.** A domain spread across two
   stores cannot be written transactionally and cannot be moved. If it needs two,
   it is two domains — or the second is a projection.
2. **A Store has exactly one writing Slice.** A store is declared _inside_ its
   owning slice, so this is structural rather than a string two declarations
   could both claim.
3. **Two domains sharing a Store are permanently co-deployed.** Not forbidden,
   but binding: separating them later is a data migration, not a refactor. It
   must be recorded with its cost, and the test requires a `bindingReason`.

A fourth rule is enforced by the boundary linter rather than these tests: **a
Next app belongs to no Slice, because it owns no Store.** A Next backend is
composition — cookies, proxying, RSC aggregation — never data access.

### `engine` is not identity

Mongo, Postgres and Redis are deployment facts. **One engine instance may host
many Stores; a Store may never span engines.** Two consequences that settle
questions people actually hit:

- Auth's `session:*` keys and marketplace-admin's saga locks share one Redis and
  are two Stores. No rule is being bent.
- **A Store's name is not its database name.** `catalog` is physically
  `tenant_<organizationId>`. The physical name encodes partitioning; the store
  name does not.

This is also what lets [ADR 0013](adr/0013-tenant-storage-on-postgres.md) move
tenant storage from Mongo to Postgres without the register changing: same store,
different engine.

### What is not a Store

The taxonomy matters as much as the definition. A **cache** is derivable and
droppable — losing it costs latency, never correctness. A **transport** is
messages in flight, not state at rest: the saga's `transactions` collection is a
store, the RabbitMQ exchange is not. A **foreign system** has an owner who is not
us — Zitadel's Postgres, reached only through its API.

### `active` and `planned`

A slice declares `status: 'active' | 'planned'`.

**Planned records ownership before a process exists**, and the three invariants
apply to it exactly as to an active one. That is the point: a boundary error is
caught when the entities land, not when someone finally writes the service.

What a planned slice may **not** do is claim a deployment. Opening a database
handle for a store nothing writes creates a persistence boundary with no contents
and no purpose — which is why `marketplace_admin` was struck from the register and
why the original `marketplace-service` was deleted rather than kept as a
placeholder to boot, probe and reason about.

**A slice is promoted by the commit that writes its store, never in advance.**

## The v1 register

The authoritative copy is `tools/slices/`; [\_shared/planes.md](_shared/planes.md)
mirrors it. Reproduced here with the reasoning, because this is the document to
land on when asking _where does this entity go?_

### Stores

| Store               | Plane    | Owner slice         | Hosts                                                 | Partitioning     | Truth                   |
| ------------------- | -------- | ------------------- | ----------------------------------------------------- | ---------------- | ----------------------- |
| `auth`              | control  | `auth`              | `authn` + `party-management` + `access-management` ⚠️ | single           | system-of-record        |
| `session`           | control  | `auth`              | — (session records, no entities)                      | single           | system-of-record        |
| `configuration`     | control  | `config`            | `config`                                              | single           | system-of-record        |
| `catalog`           | tenant   | `marketplace-admin` | `product-configuration-management`                    | per-organization | system-of-record        |
| `saga-coordination` | control  | `marketplace-admin` | — (locks + sequences)                                 | single           | system-of-record        |
| `saga`              | control  | `transaction`       | —                                                     | single           | system-of-record        |
| `catalog-reference` | platform | `marketplace`       | `catalog-reference`                                   | single           | system-of-record        |
| `published-catalog` | platform | `marketplace`       | `marketplace-catalog`                                 | single           | `projection-of:catalog` |
| `stock`             | tenant   | `stock`             | `stock-management`                                    | per-organization | system-of-record        |
| `sales`             | tenant   | `sales`             | `sales-management`                                    | per-organization | system-of-record        |
| `order`             | platform | `order`             | `order-management`                                    | single           | system-of-record        |
| `payment`           | platform | `payment`           | `payment-management`                                  | single           | system-of-record        |
| `settlement`        | control  | `settlement`        | `settlement-management`                               | single           | system-of-record        |

⚠️ **The only multi-domain store.** A `UserIdentity`, the `Individual` behind it
and the `Membership` granting it a role are written in the same breath at sign-in
and at provisioning. Accepted deliberately — an `Organization` is what makes a
tenant handle derivable, so it cannot itself live behind one — and recorded so
nobody discovers it mid-split.

Four rows worth their reasoning:

- **`catalog-reference` and `published-catalog` are two stores in one plane,
  owned by one slice.** One is authored reference data, the other is derived. A
  store carries exactly one `truth`, which is what makes them two stores and
  therefore two domains rather than one "catalog" module.
- **`catalog`, `stock` and `sales` are three tenant stores**, physically
  `tenant_<organizationId>`, `stock_<organizationId>` and
  `sales_<organizationId>`. Same plane, same partitioning, separate databases —
  so one-writer is a property of which handle a request resolves to rather than
  of review. They must never transact together anyway; a cross-domain write goes
  through the saga.
- **`settlement` is control plane** while its commerce neighbours are platform.
  An `Agreement` is the platform's own record about a vendor, the same character
  as `Entitlement`. A slice may own stores in several planes.
- **`order` holds the SID `Product`** — the instance a buyer owns after checkout —
  rather than giving it a store of its own. It is written in the same breath as
  the order that creates it.

### Slices

| Slice               | Status  | Stores                               | Deployment                        |
| ------------------- | ------- | ------------------------------------ | --------------------------------- |
| `config`            | active  | configuration                        | config-service `:3190`            |
| `auth`              | active  | auth, session                        | auth-service `:3102`              |
| `marketplace-admin` | active  | catalog, saga-coordination           | marketplace-admin-service `:3101` |
| `transaction`       | active  | saga                                 | ↳ co-deployed there               |
| `marketplace`       | active  | catalog-reference, published-catalog | marketplace-service `:3100`       |
| `stock`             | planned | stock                                | — (target `:3108`)                |
| `order`             | planned | order                                | — (target `:3105`)                |
| `payment`           | planned | payment                              | — (target `:3106`)                |
| `settlement`        | planned | settlement                           | — (target `:3107`)                |
| `sales`             | planned | sales                                | — (target `:3109`)                |

**Co-deployment is reversible; merging stores is not.** Two slices sharing a
process keeps ownership where it was — splitting back out means pointing a
declaration's `deployments` at a new app. Two domains sharing a store is a data
migration. Keeping those facts in separate columns is what stops a cheap decision
being mistaken for a binding one.

## How a boundary decision gets made

Four questions, in order. Each has one answer, and answering them out of order is
how a domain ends up with two stores.

1. **Who may read it? → the plane.**
   Everyone, including anonymous storefront traffic → **platform**. Exactly one
   organization → **tenant**. The platform itself, or the record that makes an
   organization exist → **control**.

   An entity that seems to want two planes is usually **two entities**: a
   tenant-authored record and a published projection of it, the second carrying
   `truth: projection-of:<store>`. That is exactly the catalog's shape, and
   ADR 0012's cross-tenant reporting is the same shape again.

2. **Who writes it? → the store.**
   If an existing store has the same plane _and_ the same writer, it belongs
   there. If the writer differs, it is a new store — even if the plane and the
   partitioning match, which is why `stock` is not part of `catalog`.

3. **Can it be split off later? → the slice.**
   A new store needs an owning slice. Reuse an existing one when the same code
   writes both; declare a new one when the scale profile or the release cadence
   genuinely differs, since declaring it costs nothing and retrofitting it costs
   a migration.

4. **Does it deploy yet? → the status.**
   `planned` until the commit that writes the store. Not before.

Then two rules that apply to the entity itself:

- **Entities are organization-agnostic.** No `organizationId` member, no tenant
  filter to write. Isolation comes from _which database handle the request
  resolves to_, which is why no query can leak by omission — a discriminator
  column makes every missing filter a silent breach. See
  [ADR 0006](adr/0006-multitenancy-planes-and-tenant-storage.md).
- **A cross-store reference is an id, never a `link`.** A `link` accessor invites
  a storage-layer join, and the target is another slice's store. Resolve through
  the owning domain's use-case port instead.

### The three planes

| Plane        | Storage                                                                          | Holds                                                                                                           |
| ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Control**  | one shared database                                                              | Organization, Individual, Membership, Role, Entitlement, users, sessions, configuration, agreements and payouts |
| **Platform** | one shared database                                                              | published catalog, catalog vocabulary, buyer orders, payments                                                   |
| **Tenant**   | **three databases per organization** — `tenant_<id>`, `stock_<id>`, `sales_<id>` | vendor-authored offerings, specifications, pricing, stock, selling channels                                     |

## Capability map

| Capability                 | ODA analog                                                     | Package                                        | Plane    | Store               | Status   |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------- | -------- | ------------------- | -------- |
| Party Management           | Party Management (TMFC028)                                     | `business-ts-party-management`                 | control  | `auth`              | entities |
| Access Management          | Permissions Management (TMFC035)                               | `business-ts-access-management`                | control  | `auth`              | entities |
| Configuration              | —                                                              | `business-ts-configuration`                    | control  | `configuration`     | in use   |
| Identity & Sessions        | Digital Identity Mgmt (TMFC020)                                | `business-ts-authn`                            | control  | `auth`              | in use   |
| Product Configuration Mgmt | Product Catalog Mgmt (TMFC001), Product Configurator (TMFC027) | `business-ts-product-configuration-management` | tenant   | `catalog`           | in use   |
| Catalog Reference          | Product Catalog Mgmt (TMFC001), classification half            | `business-ts-catalog-reference`                | platform | `catalog-reference` | entities |
| Marketplace Catalog        | Product Catalog Mgmt, published view                           | `business-ts-marketplace-catalog`              | platform | `published-catalog` | entities |
| Stock Management           | — (no ODA analog)                                              | `business-ts-stock-management`                 | tenant   | `stock`             | entities |
| Order Management           | Product Order Capture & Validation (TMFC002)                   | `business-ts-order-management`                 | platform | `order`             | entities |
| Payment Management         | Payment Management (TMFC029)                                   | `business-ts-payment-management`               | platform | `payment`           | entities |
| Settlement Management      | Agreement Mgmt (TMFC039), partner revenue                      | `business-ts-settlement-management`            | control  | `settlement`        | entities |
| Sales Management           | — (no ODA analog); SID Market/Sales, Sales Channel ABE         | `business-ts-sales-management`                 | tenant   | `sales`             | entities |
| Fulfillment                | Shipping & Logistics                                           | _not yet_                                      | —        | —                   | —        |

`entities` means the domain's entity skeletons and its store are declared, with
use-cases and adapters still to come. Every capability above owns exactly one
store, and every store has one writing slice — see the register.

Authorization vocabulary (`business-ts-authz`) is not a capability — it is the
shared policy language every capability expresses itself in, which is why it is
tagged `business:policy` rather than `business:domain`.

Sales Management is the one capability whose ODA half stays empty. The SID
side is confirmed — the Sales Channel ABE is in the Market/Sales domain of
GB922 — but no ODA component covers sales channel management in any source that
can be read: `tmforum.org/oda/directory/components-map` answers `403` to every
fetch, the `oda-directory.labs.tmforum.org` mirror `500`s or redirects into the
same `403`, and the one readable inventory (TM Forum's repository of delivered
components) contains none. That inventory is a subset of IG1242, so this is
"none found in what is reachable" rather than proof of absence — recorded here
so the next person does not repeat the four lookups. It is also why the cell
carries no code: a web search will confidently return one (`TMFC019` for
"Channel Management") and it is wrong — TMFC019 is Event Management, and the
same search misnames TMFC035, which the row above already has right.

Note that ODA separates Permissions Management (TMFC035) from Party Management
(TMFC028) as distinct components. Our split is the same split, for the same
reason: who a party _is_ changes on a different clock from what it may _do_.

### Module = business domain = permission namespace

A permission is `` `<domain>:<entityKey>:<action>` ``, derived from the entity's
own `@entity({ domain, key })`. So the _module_ a vendor grants one of its staff
("inventory only"), the _domain_ a package owns, and the _permission namespace_
that guards a route are all the same word. There is no separate module registry
to keep in sync, and an organization's `Entitlement` is a list of domain names.

**One exception, and it is a security boundary.** `catalog-reference` is
operator-authored platform vocabulary and can never appear in an `Entitlement`
([ADR 0022](adr/0022-v1-marketplace-module-boundaries.md)). An organization is not
"provisioned for" the platform's shared classification, and a tenant role mintable
against it would let one vendor rewrite the browse tree every other vendor is
classified into. So the entitlement vocabulary is the set of **tenant-facing**
domains, not the set of all domains.

## The catalog crosses planes

Vendors author their catalogs in tenant storage; the storefront is
platform-scope and cannot read tenant storage. So the catalog is deliberately two
things:

1. A vendor authors `ProductOffering` / `ProductOfferingPrice` in **their own**
   tenant storage (product-configuration-management).
2. **Publishing** projects the approved subset into the platform-scope
   marketplace catalog the storefront queries.

The projection runs on the existing saga engine (the `transaction` slice's
tracker + `entifix-transactions`). This buys approval and moderation, price snapshots taken
at publish time, and a storefront whose read path cannot be slowed by a tenant's
write load.

**The writer is the consumer, not the author.** marketplace-admin emits
`catalog.published`; the `marketplace` slice consumes it and writes
`published-catalog`. Both arrangements satisfy one-writer, and this one is chosen
because the public read host then never opens a connection to tenant storage at
all — the isolation property becomes structural rather than a rule about which
query a route makes.

The vocabulary the catalog is classified _in_ — brands, categories, dictionary
terms — is a **third** thing, and it is neither tenant-authored nor derived. It is
platform-plane reference data in `catalog-reference`, authored by the operator,
because a marketplace has to merge: there is no correct way to decide that two
vendors' private "Electronics" rows are the same node.

Consequence to accept: **published data is eventually consistent.** The
storefront's availability badge is a hint; the checkout reservation is the truth.

> **Trap.** Do not "fix" the staleness by having the storefront call a
> tenant-plane service. That puts a per-request round trip on a prerendered
> public path and ends ISR — trading a correct, cheap hint for an expensive one
> that is still stale by the time the buyer clicks.

Design detail in [ADR 0009](adr/0009-catalog-authoring-and-publication.md).

## Vendors design their own products

Fixed entities put the operator on the critical path of every onboarding: a
vendor's new field is a platform release. So a vendor authors an
`EntitySpecification` — a versioned list of characteristics — and an offering
pins the version it was written under. Released versions are immutable, which is
what makes February's records still readable after March's redefinition, and what
lets a published specification be shared by content hash instead of copied per
offering.

The skeleton stays fixed. `ProductOffering` keeps its typed members, because the
storefront prerenders and checkout prices against them; only the characteristics
are specification-driven. None of this replaces the entifix metadata mechanism —
the specification entities are themselves ordinary decorated entities, so the
designer UI is `EntityTable` + `EntityForm` over them.

Free-form characteristics leave a vendor unblocked but not comparable: two
vendors' `talla` and `size` cannot share a facet. Comparability comes from a
platform-owned **dictionary** of terms — code, value set, unit — that a vendor
characteristic may resolve to. A vendor may narrow a term's values, never widen
them, and the vocabulary grows from the free-form codes that turn out to recur
across tenants.

Design detail in
[ADR 0014](adr/0014-entity-specifications-and-the-characteristic-dictionary.md),
which also sets the order the work lands in.

## Quantities, concurrency, and the buyer's promise

The scenario that tests the whole design: a buyer purchases while the vendor
receives new stock, both touching the same product's availability.

**Availability is not a field on `Product`.** A product definition is owned by
product-configuration-management; stock is a fact owned by stock-management.
Putting a quantity on the product would make two domains write one record —
precisely the coupling the decomposition exists to prevent.

Two rules follow, and they hold regardless of how many services are deployed:

1. **A quantity is never read-modify-written.** Absolute-value writes lose
   updates even inside a single process handling two requests. Quantities move by
   atomic in-place operators (`$inc`, `SET qty = qty + $1`) over an append-only
   movement ledger, with the running total materialized. Audit and reconciliation
   come free, and a future logistics integration is one more movement type.
2. **A purchase reserves, it does not decrement.** Checkout takes a _conditional_
   atomic write — increment `reserved` only where `onHand - reserved >= qty` —
   which is itself the concurrency control: zero rows matched means out of stock,
   answered immediately. The reservation carries a TTL; payment success converts
   it to a sale movement, failure or expiry releases it.

The vendor's `+50 onHand` and the buyer's guarded `+1 reserved` touch different
fields, are both atomic, and are order-independent. There is no race to resolve
and no distributed transaction to coordinate.

> **Trap.** Do not take a distributed lock per decrement. `LockService` is for
> coarse operations — a catalog publication, a settlement run, an order spanning
> several vendors. A Redis lock per product serializes every purchase of a
> popular item through one key, capping throughput at one lock round-trip and
> surfacing contention to real buyers as `409`. The conditional update has no
> such ceiling.

The saga's role here is the cross-plane part: order-management (platform) calls
stock-management (tenant) synchronously to reserve — the buyer needs an answer
now — and holds a _reservation id_, never a quantity. If the order write then
fails, the compensation releases the reservation.

This design is forced by **payment latency**, not by service topology: a database
transaction cannot be held open across an external payment, so reservations would
be required even with everything in one database.

Full design in
[ADR 0010](adr/0010-stock-ledger-reservations-and-concurrency.md).

## How each module extends

| Today                                  | Later, without a rewrite                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| `ProductOffering` with a one-off price | recurring price → subscriptions; usage price → metered services       |
| `EntitySpecification` over a product   | the same pattern over a service or a resource spec                    |
| Stock movements                        | a shipment is a movement type; a warehouse is a movement location     |
| `PricingLogicAlgorithm` as a port      | promotions, tiered and contract pricing behind the same seam          |
| Marketplace catalog projection         | any read model the storefront needs (search index, recommendations)   |
| Settlement over vendor sales           | any partner revenue share, including non-commerce applications        |
| `Organization` + `Entitlement`         | provisioning CRM/ERP/analytics alongside commerce for the same tenant |
| `PartyRole`                            | an organization that is a vendor here and a customer there            |

## Deliberately out of scope

Fulfillment and logistics · payment service provider integration · tax
calculation · returns and RMA · search relevance · recommendations · the
dedicated operator bastion app · anything CRM/ERP/analytics.

Four more, decided in [ADR 0022](adr/0022-v1-marketplace-module-boundaries.md)
and named here so their absence reads as a decision:

- **Operator moderation of catalogs.** Publication is vendor-initiated and
  unmoderated. ADR 0012's `Crossing` is not built, which keeps the `auth` store
  at three bound domains instead of four.
- **A server-side cart.** It stays a cookie, so the storefront's first response is
  correct with no round trip and the fleet keeps zero anonymous write surfaces.
  The price is multi-device carts and abandoned-cart recovery.
- **A private `VendorCategory`** beside the platform taxonomy. Defensible, and
  deferred until a vendor asks.
- **`partyRole` scoped to the active organization.** v1 resolves a multi-role
  party by precedence (`operator` > `vendor` > `customer`), so there is no way to
  act as a buyer while being staff.

Named so the map's silence reads as a decision rather than an oversight.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — layering, use-cases, adapters, auth, transactions
- [ENTIFIX.md](ENTIFIX.md) — the entity framework the domains are written in
- [DEVELOPING.md](DEVELOPING.md) — workspace, module boundaries, conventions
- [\_shared/planes.md](_shared/planes.md) — the plane and ownership rules, imported by `CLAUDE.md`
