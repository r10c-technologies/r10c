# 5. Business domain decomposition, named from TM Forum ODA/SID

- Status: Accepted
- Date: 2026-08-01
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  the `Product` split is done rather than deferred, `catalog-reference` joins the
  capability map, and the Context paragraph describing a three-entity business is
  marked as of its date.

## Context

Five iterations built the platform — the entity framework, the layering, auth,
i18n, observability, the saga engine. The business it exists to run is three
entities deep: `Product`, `ProductBrand`, `ProductCategory`, all in
`business-ts-product-configuration-management`. `apps/marketplace-service` is an
empty stub with a `main.ts` and nothing else.

> **Revised 2026-08-12.** That paragraph describes 2026-08-01 and is kept as the
> context this record was decided in. Since then:
> [ADR 0022](0022-v1-marketplace-module-boundaries.md) took the business to 23
> entities across 11 domains, `ProductBrand`/`ProductCategory` moved to a
> platform-plane `catalog-reference` domain, and `apps/marketplace-service` was
> deleted by [ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md)
> for having no store and rebuilt by 0022 once it had two.

The target is a multi-tenant SaaS ecosystem — commerce first, then CRM, ERP,
analytics — where an organization provisions the applications it needs. The first
stage is a marketplace: many vendors selling to final users through one
storefront.

Naming a domain badly is expensive in a way that naming a variable badly is not:
the name reaches the permission namespace (`<domain>:<entityKey>:<action>` is
derived from `@entity({ domain, key })`), the package path, the config-service
rows, and every future conversation. Renaming later means a coordinated change
across all of them plus a data migration of grants.

## Decision

### Borrow TM Forum ODA/SID for the decomposition and the vocabulary

**Adopted**: the split into business capabilities, the domain names, and the
entity vocabulary — `Party`, `PartyRole`, `ProductSpecification`,
`ProductOffering`, `ProductOfferingPrice`, `ProductOrder`.

**Not adopted**: TMF Open API conformance, the ODA Canvas, canonical REST payload
shapes, certification. We are not a telco and have no interoperability
requirement that would pay for the ceremony.

The payoff is a domain language that is already thought through, and already
unambiguous about distinctions most codebases collapse and then cannot separate
again.

Rejected: inventing our own vocabulary (cheap today, and it would have produced
exactly the `Product`-means-three-things problem below), and adopting ODA
wholesale (canonical APIs and Canvas conformance we would never exercise).

### The capability map

| Capability                 | ODA analog                                                     | Package                             | Plane    |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------- | -------- |
| Party Management           | Party Management (TMFC028)                                     | `business-ts-party-management`      | control  |
| Access Management          | Permissions Management (TMFC035)                               | `business-ts-access-management`     | control  |
| Product Configuration Mgmt | Product Catalog Mgmt (TMFC001), Product Configurator (TMFC027) | existing                            | tenant   |
| Catalog Reference          | Product Catalog Mgmt (TMFC001), classification half            | `business-ts-catalog-reference`     | platform |
| Marketplace Catalog        | Product Catalog Mgmt, published view                           | `business-ts-marketplace-catalog`   | platform |
| Stock Management           | —                                                              | `business-ts-stock-management`      | tenant   |
| Order Management           | Product Order Capture & Validation (TMFC002)                   | `business-ts-order-management`      | platform |
| Payment Management         | Payment Management (TMFC029)                                   | `business-ts-payment-management`    | platform |
| Settlement Management      | Agreement Mgmt (TMFC039)                                       | `business-ts-settlement-management` | platform |

Planes are defined in [ADR 0006](0006-multitenancy-planes-and-tenant-storage.md).

### Access Management is separate from Party Management

ODA separates Permissions Management (TMFC035) from Party Management (TMFC028) as
distinct components, and the reason applies here unchanged: who a party _is_
changes on a different clock from what it may _do_. `Organization` and
`Individual` are stable records; role definitions and grants churn.

`business-ts-authz` stays `business:policy` — the shared vocabulary
(`Permission`, `canAssignRole`, the ports) that any domain may express itself in.
`business-ts-access-management` is `business:domain` because it owns entities and
a repository, which `business:policy` must not.

`Membership` and `Role` live together in access-management rather than splitting
`Membership` into party-management. The layering rule forbids sideways edges
between `business:domain` packages, so a split would force `Membership` to hold
an opaque `roleId` with no type safety across the seam — cost with no benefit,
since a membership exists only in order to grant access.

### A persona is a `PartyRole`, not an entity type

`Party` is abstract; every party is an `Individual` or an `Organization`. SID
makes `Customer` a subclass of `PartyRole` precisely so a party is never
hard-wired as one thing.

So: the **tenant** is an `Organization`. `vendor`, `customer` and `operator` are
`PartyRole`s a party plays.

Rejected: "vendor = Organization, buyer = Individual, operator = a flag". It
reads simpler and it forecloses a B2B buyer, a vendor purchasing from another
vendor, and an organization that is a marketplace vendor _and_ a CRM customer —
which is the entire point of the long-run ecosystem.

### `Product` is three SID concepts, and they get separated

- **`ProductSpecification`** — what the thing _is_; facts common to every
  instance. Definitional, not commercial.
- **`ProductOffering`** — the commercial packaging: what is orderable from a
  catalog, priced by `ProductOfferingPrice` and termed by `ProductOfferingTerm`.
- **`Product`** — an **instance** owned or subscribed to by a party.

Today's `Product` (`business/ts/product-configuration-management/src/entities/product/product.entity.ts`)
is specification and offering fused. The map names all three now; the entity
migration lands with the catalog work
([ADR 0009](0009-catalog-authoring-and-publication.md)).

> **Revised 2026-08-12 — done.** The split landed in
> [ADR 0022](0022-v1-marketplace-module-boundaries.md), earlier than "with the
> catalog work" because the entity key moves a permission namespace, an i18n
> catalog key, a route path and a tenant collection name at once, and every
> entity added first makes that sweep larger. `Product` is now
> `ProductSpecification`; `ProductOffering` and `ProductOfferingPrice` are
> separate entities; and the name `Product` went to its SID meaning — the
> instance a party owns after an order completes, in `order-management`.

SID also separates the price _value_ from **`PricingLogicAlgorithm`** — an
interface to a rating function with some parameters bound and some gathered at
rating time. SID deliberately models the seam and not the behaviour, which is
exactly a port. That is the extension point for promotions, tiered pricing and
usage-based rating, and it exists in the vocabulary from day one.

### Stock is `stock-management`, not `inventory-management`

TMF637 **Product Inventory means instances of an offering subscribed by a
party** — assets and subscriptions — not warehouse stock. Telecom has no
warehouse.

Calling our stock domain `inventory-management` would mislead anyone who knows
ODA, and would consume the name we genuinely need the moment subscriptions land,
which is the first extension the marketplace is designed for. `stock-management`
owns `StockItem` / `StockMovement` / `Reservation`; `product-inventory` stays
free for TMF637's meaning.

## Consequences

- **A domain rename is now expensive on purpose.** Each package exports a
  `<DOMAIN>_DOMAIN` constant that is simultaneously the package identity, the
  `@entity({ domain })` value and the permission namespace.
  `business-ts-authz/values/role-permissions.ts` already hand-declares
  `CATALOG_DOMAIN`/`AUTHN_DOMAIN` for exactly this reason; it should import them
  from the owning packages as those gain entities.
- **`module` has one meaning across three systems.** The module a vendor grants
  its staff, the domain a package owns, and the permission namespace guarding a
  route are the same word — so an organization's provisioning is a list of domain
  names and needs no separate registry.
- **Most packages ship as skeletons.** They carry the domain constant, a header
  comment naming their plane, ODA analogue and governing ADR, and nothing else.
  That is deliberate: the vocabulary is fixed while it is still cheap to change,
  and an empty-but-named package is a smaller lie than a wrong entity.
- **Every `packages/*` project is coverage-gated at 100%**, so a genuinely empty
  package would fail its own gate. The domain constant plus its spec is what
  makes a skeleton buildable, and it is a real export rather than gate-padding.
- **ODA vocabulary will occasionally read oddly for e-commerce.** "Product
  Offering" where a shop would say "listing". Accepted: the precision is worth
  more than the familiarity, and the glossary in
  [BUSINESS-ARCHITECTURE.md](../BUSINESS-ARCHITECTURE.md) carries the mapping.

## Follow-ups (deliberately out of scope)

- The `Product` → `ProductSpecification`/`ProductOffering` entity migration.
- Fulfillment, tax, returns, search relevance, recommendations.
- Any CRM/ERP/analytics domain — named in the target, not in the map.
