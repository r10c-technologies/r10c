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
[ADR 0011](adr/0011-organization-provisioning-and-migrations.md).
Decisions already reasoned through but not yet implemented are recorded as
**Proposed** ADRs — [0009](adr/0009-catalog-authoring-and-publication.md),
[0010](adr/0010-stock-ledger-reservations-and-concurrency.md),
[0012](adr/0012-operator-cross-tenant-access.md),
[0013](adr/0013-tenant-storage-on-postgres.md) — so the next iteration inherits
the reasoning instead of re-deriving it.

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

Two deltas worth recording explicitly, because a reader who knows ODA will look
for them:

- **ODA is silent on multi-tenancy.** Tenant isolation is absent from the ODA
  component design guidelines. The plane model below is ours, and no ODA
  guidance contradicts or endorses it.
- **ODA's "Product Inventory" is not stock.** See the glossary entry.

## Glossary

The anti-drift artifact. Most of a domain model's cost is people meaning
different things by "product".

| Term                      | Meaning                                                                                                                                                                                              | Source        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Party**                 | A person or company known to the platform. Abstract: always an `Individual` or an `Organization`. Recorded before it plays any role.                                                                 | SID           |
| **Individual**            | A `Party` that is a person.                                                                                                                                                                          | SID           |
| **Organization**          | A `Party` that is a company. **The tenant**: the unit tenant storage is provisioned for.                                                                                                             | SID           |
| **PartyRole**             | A role a `Party` plays — `vendor`, `customer`, `operator`. SID makes `Customer` a subclass of `PartyRole` precisely so a party is never hard-wired as one thing; a party plays many roles over time. | SID           |
| **Membership**            | A `Party`'s participation in an `Organization`, carrying the roles it holds there.                                                                                                                   | ours          |
| **Entitlement**           | The set of business domains an `Organization` is provisioned for. The ceiling on what its tenant roles may grant.                                                                                    | ours          |
| **ProductSpecification**  | What a thing _is_ — the facts common to every instance of it. Definitional, not commercial.                                                                                                          | SID           |
| **ProductOffering**       | The commercial packaging: what is orderable from a catalog, priced and termed.                                                                                                                       | SID           |
| **ProductOfferingPrice**  | A price attached to an offering. Separable from the offering so one offering can be priced several ways.                                                                                             | SID           |
| **PricingLogicAlgorithm** | An interface to a rating function, with some parameters bound and some gathered at rating time. SID deliberately models the _seam_, not the behaviour — which is exactly a port.                     | SID           |
| **Product**               | An **instance** of an offering, owned or subscribed to by a party. Not a catalog record.                                                                                                             | SID           |
| **ProductOrder**          | A party's request for one or more offerings.                                                                                                                                                         | SID           |
| **StockItem**             | Physical availability of a product for a vendor.                                                                                                                                                     | ours          |
| **StockMovement**         | An append-only record of a quantity change (+receipt, −sale, +cancellation). The ledger `StockItem` totals.                                                                                          | ours          |
| **Reservation**           | A time-limited hold on stock taken at checkout, converted to a sale on payment or released on expiry.                                                                                                | ours          |
| **Agreement**             | The contract between the platform and a vendor: commission, terms, obligations. Where commission rates live.                                                                                         | ODA (TMFC039) |
| **Plane**                 | Which storage boundary an entity lives behind: control, platform, or tenant. Part of the entity's definition, not a deployment detail.                                                               | ours          |
| **Tenant**                | An `Organization` together with the storage provisioned for it.                                                                                                                                      | ours          |

## Personas

| Persona      | A tenant?                   | Data scope                                                  | Lifecycle               |
| ------------ | --------------------------- | ----------------------------------------------------------- | ----------------------- |
| **Buyer**    | No                          | own cart and orders                                         | self-registers          |
| **Vendor**   | **Yes — an `Organization`** | its own tenant storage only                                 | onboarded as a customer |
| **Operator** | No                          | control plane, and cross-tenant only by an audited crossing | platform staff          |

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

Vendor and operator share one back-office host (marketplace-admin-app) with
permission-gated navigation. Two personas, one app.

## Data planes

Three planes, three storage boundaries.

| Plane        | Storage                                                                                                                | Holds                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Control**  | one shared database                                                                                                    | Organization, Individual, Membership, Role, Entitlement, users, sessions, configuration |
| **Platform** | one shared database                                                                                                    | published marketplace catalog, buyer carts and orders                                   |
| **Tenant**   | **one Mongo database per organization** (and, when a Postgres-backed tenant domain lands, one schema per organization) | vendor-authored offerings, cost, pricing rules, stock                                   |

**Deciding a new entity's plane** — ask who may read it:

- everyone, including anonymous storefront traffic → **platform**;
- exactly one organization → **tenant**;
- the platform itself, or the record that makes an organization exist →
  **control**.

An entity that seems to want two planes is usually two entities — a
tenant-authored record and a published projection of it. That is exactly the
catalog's shape.

Entities themselves are **organization-agnostic**: no `organizationId` member, no
tenant filter to write. Isolation comes from _which database handle the request
resolves to_, which is why no query can leak by omission. See
[ADR 0006](adr/0006-multitenancy-planes-and-tenant-storage.md).

## Capability map

| Capability                 | ODA analog                                                     | Package                                        | Plane    | Status   |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------- | -------- | -------- |
| Party Management           | Party Management (TMFC028)                                     | `business-ts-party-management`                 | control  | entities |
| Access Management          | Permissions Management (TMFC035)                               | `business-ts-access-management`                | control  | entities |
| Configuration              | —                                                              | `business-ts-configuration`                    | control  | in use   |
| Identity & Sessions        | Digital Identity Mgmt (TMFC020)                                | `business-ts-authn`                            | control  | in use   |
| Product Configuration Mgmt | Product Catalog Mgmt (TMFC001), Product Configurator (TMFC027) | `business-ts-product-configuration-management` | tenant   | in use   |
| Marketplace Catalog        | Product Catalog Mgmt, published view                           | `business-ts-marketplace-catalog`              | platform | skeleton |
| Stock Management           | — (no ODA analog)                                              | `business-ts-stock-management`                 | tenant   | skeleton |
| Order Management           | Product Order Capture & Validation (TMFC002)                   | `business-ts-order-management`                 | platform | skeleton |
| Payment Management         | Payment Management (TMFC029)                                   | `business-ts-payment-management`               | platform | skeleton |
| Settlement Management      | Agreement Mgmt (TMFC039), partner revenue                      | `business-ts-settlement-management`            | platform | skeleton |
| Fulfillment                | Shipping & Logistics                                           | _not yet_                                      | —        | —        |

Authorization vocabulary (`business-ts-authz`) is not a capability — it is the
shared policy language every capability expresses itself in, which is why it is
tagged `business:policy` rather than `business:domain`.

Note that ODA separates Permissions Management (TMFC035) from Party Management
(TMFC028) as distinct components. Our split is the same split, for the same
reason: who a party _is_ changes on a different clock from what it may _do_.

### Module = business domain = permission namespace

A permission is `` `<domain>:<entityKey>:<action>` ``, derived from the entity's
own `@entity({ domain, key })`. So the _module_ a vendor grants one of its staff
("inventory only"), the _domain_ a package owns, and the _permission namespace_
that guards a route are all the same word. There is no separate module registry
to keep in sync, and an organization's `Entitlement` is a list of domain names.

## The catalog crosses planes

Vendors author their catalogs in tenant storage; the storefront is
platform-scope and cannot read tenant storage. So the catalog is deliberately two
things:

1. A vendor authors `ProductOffering` / `ProductOfferingPrice` in **their own**
   tenant storage (product-configuration-management).
2. **Publishing** projects the approved subset into the platform-scope
   marketplace catalog the storefront queries.

The projection runs on the existing saga engine (`transaction-manager` +
`entifix-transactions`). This buys approval and moderation, price snapshots taken
at publish time, and a storefront whose read path cannot be slowed by a tenant's
write load.

Consequence to accept: **published data is eventually consistent.** The
storefront's availability badge is a hint; the checkout reservation is the truth.

> **Trap.** Do not "fix" the staleness by having the storefront call a
> tenant-plane service. That puts a per-request round trip on a prerendered
> public path and ends ISR — trading a correct, cheap hint for an expensive one
> that is still stale by the time the buyer clicks.

Design detail in [ADR 0009](adr/0009-catalog-authoring-and-publication.md).

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

Named so the map's silence reads as a decision rather than an oversight.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — layering, use-cases, adapters, auth, transactions
- [ENTIFIX.md](ENTIFIX.md) — the entity framework the domains are written in
- [DEVELOPING.md](DEVELOPING.md) — workspace, module boundaries, conventions
- [\_shared/planes.md](_shared/planes.md) — the plane and ownership rules, imported by `CLAUDE.md`
