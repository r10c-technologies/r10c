# 24. Selling through a vendor's own channel

- Status: Accepted
- Date: 2026-08-17

## Context

Every sale this platform can describe originates in the marketplace storefront.
That was never decided; it is what the absence of a decision looks like.

The evidence is in the entities rather than in any document.
`ProductOrder.buyerId` is `required`, so an order presupposes an account.
`Payment` records an amount, a currency and a provider reference, so a payment
presupposes a payment service provider. Neither carries any member naming where
the sale came from, because there was only one answer and nothing had to
distinguish it. [ADR 0022](0022-v1-marketplace-module-boundaries.md) fixed
eleven domains without a sales channel among them — correctly, for a storefront.

A vendor is an `Organization` that sells. Restricting them to selling _here_
makes the platform a sales channel rather than the vendor's commerce system, and
the first vendor with a physical shop discovers it. The consequences are not
cosmetic: their in-shop sales never decrement the stock this platform tracks, so
the storefront oversells; their takings never reach settlement, so a commission
statement describes a fraction of their business; and there is no record anywhere
of a sale the vendor certainly made.

So: a vendor should be able to sell in-site as well as through the storefront.
The question this record answers is what shape that takes — and the answer is
smaller than the question suggests, because the obvious construction is wrong.

## Decision

**An in-store sale is a channel on the same order, not a different kind of
order.**

This is TM Forum's answer, not ours, and finding it changed the design. TMF622's
`ProductOrder` carries `channel: RelatedChannel[]` — "may be online web, mobile
app, social" — and TMF676's `Payment` carries a `channel` of its own. SID names
the concept in the Market/Sales domain's **Sales Channel ABE**. The standard
models origin as an attribute of the sale, and nowhere forks the order by it.

The construction we did not build is the intuitive one: a `CounterSale` entity, a
point-of-sale slice that owns it, and a second path into stock and settlement.
It fails on the second question you ask of it. A vendor's monthly takings are
then two queries against two shapes; a return against a counter sale is a
different code path from a return against a storefront order; the buyer who
bought in the shop and online has two histories. Every one of those is a
permanent seam, bought to avoid adding one member to an existing class.

Four decisions follow.

### 1. `SalesChannel` is a new tenant-plane domain

A new `sales-management` domain owning one entity, `SalesChannel` — `name`,
`type` (`storefront` / `counter` / `phone` / `external`), `status` — in a new
`sales` store, tenant plane, per-organization, owned by a new `sales` slice at
`status: 'planned'`.

**Tenant plane**, and the contrast with `catalog-reference` is the reason rather
than an analogy. Brand and category are platform plane because a marketplace has
to _merge_ them: two vendors' private "Electronics" can never become one browse
tree, so the vocabulary must be shared and operator-owned. Channels are the exact
inverse. One vendor's counter means nothing to another, there is nothing to
reconcile, and no reader outside the owning organization has any use for the
list. A per-vendor thing in a shared store would be a discriminator column, which
[ADR 0006](0006-multitenancy-planes-and-tenant-storage.md) rejects precisely
because every missing filter becomes a silent breach.

**Its own store**, not a corner of `catalog`. Two domains in one store is a
binding under [ADR 0020](0020-stores-and-slices.md) — permanently co-deployed,
separable only by a data migration. A vendor's channel configuration and their
product catalog have no reason to be welded, and `auth` should remain the only
multi-domain store in the repository.

`planned`, with no deployment, because nothing writes it yet. Recording ownership
before a process exists is the mechanism ADR 0022 introduced for exactly this
case: the boundary is decided now, by this record, rather than later by whoever
writes the first route.

### 2. The channel travels onto the order as a copy, and onto the payment as an id

`ProductOrder` gains `channel: RelatedChannel` — `{ id, name, type }`,
denormalized. `Payment` gains `channelId: string`, a bare id.

The asymmetry is deliberate and follows from who reads each record. An order is
shown to the **buyer**, who holds no tenant handle and cannot dereference a
tenant-plane pointer at all; so the name travels with the order, exactly as
`PublishedOffering` copies price and vendor rather than linking to them. A
payment is read by the **vendor** reconciling their own takings and by
settlement, both of which can resolve the channel in the store that owns it; so
an id suffices.

Neither is a `link`. The target is another slice's store, and a typed link would
be both an illegal import under the boundary rule and the storage-layer join
`_shared/planes.md` forbids.

The copy is taken at capture and never refreshed. Renaming a channel does not
rewrite history, which is the correct behaviour for a receipt.

### 3. `buyerId` becomes optional

A walk-in at a counter has no account. The alternatives were considered and are
worse: demanding registration at the register is friction that gets worked around
by staff inventing junk parties, and a synthetic "walk-in" party per channel puts
a fake `Individual` in `party-management` that every report must learn to
exclude.

An absent buyer is honest, and `channel` is what explains it — an order with no
buyer came through a channel where anonymity is normal.

The cost, stated so it is not later rediscovered as a bug: a buyer's order list
does not match these, and attaching a party to a past counter sale — for a return,
or a loyalty scheme — is a backfill rather than a lookup.

### 4. Commission is per channel type, with a default

`Agreement` keeps `commissionBasisPoints` as the default rate and gains
`channelCommissionBasisPoints`, a partial map keyed by channel type. `Agreement`
also gains a `commissionFor(channelType)` method, and settlement must use it.

A single rate stops being expressible the moment a vendor sells in their own
shop. A platform taking 8% on a sale it sourced through the storefront has a much
weaker claim on a sale the vendor made to their own walk-in, and "0% on your own
counter" is a term people negotiate. Putting the answer on the `Agreement` rather
than in code makes it a contract term that varies per vendor and is auditable as
of a date — the same argument that kept commission off `Organization`.

A default plus overrides rather than a full table, because most channels take the
headline rate and an agreement should not have to enumerate them. The one trap
worth naming: a rate of `0` is meaningful, so resolution cannot be
`rates[type] || fallback` — that expression charges full commission for a free
channel. `commissionForChannel` checks for `undefined` explicitly and is tested
on that case.

## What this deliberately does not change

Stating these because each is a mechanism someone could reasonably expect to be
touched, and touching any of them would be the actual cost of this feature.

- **No new tenant crossing.** A vendor at a counter does not write the
  platform-plane `order` store directly; it calls the order slice through
  `POST /api/product-order`. "A slice writes only the stores it owns" holds
  unamended, and [ADR 0023](0023-service-to-service-tenant-crossing.md) remains
  the single named path it was written to be. Its `## Trigger` does not fire.
- **No new authorization mechanism.** A vendor may create an order only when
  every line carries its own `vendorId` — a `PolicyDecisionTag` rule, the ABAC
  seam [ADR 0002](0002-authorization-roles-and-abac.md) already put there.
- **No change to the reservation flow.** A counter sale still reserves and then
  converts, rather than writing a direct `sale` movement. A second path through
  stock is not worth avoiding a zero-length reservation, and
  [ADR 0010](0010-stock-ledger-reservations-and-concurrency.md) already covers
  the arithmetic. `MovementReasons` already contains `sale`.
- **No till.** Cash drawers, shift floats, blind counts and variance have no ODA
  or SID name — that vocabulary is retail's (NRF/ARTS), not telco's — so every
  field would be invented. Deferred until a vendor asks for cash reconciliation
  rather than guessed at now. A `PointOfSaleSession` would be a second entity in
  the `sales` store, so the boundary does not move when it lands.

## Consequences

- **This record amends ADR 0022 and ADR 0011 in place**, and supersedes neither.
  ADR 0022's inventory moves from eleven domains, 28 entities, 12 stores and 9
  slices to twelve, 29, 13 and 10 — deployments unchanged at six, because the
  `sales` slice is planned. ADR 0011's claim that an organization has two tenant
  databases becomes three. Both records' _reasoning_ holds unchanged; only their
  factual inventories moved, which is a correction rather than a reversal.
- **The first duplicated vocabulary between two business domains.**
  `settlement-management` cannot import `SalesChannelTypes` — `business:domain`
  never depends on another `business:domain` — so
  `CommissionableChannelTypes` copies the four literals. This is the same shape
  as every cross-store id in the repository, except the _values_ are copied
  rather than a key, and nothing keeps the two lists in step: a channel type
  added in one and not the other silently becomes unpriceable and falls through
  to the default rate. Both lists are pinned by a spec so the drift shows in a
  diff. If it ever bites, the fix is a shared `business:policy` vocabulary
  package, not a dependency edge.
- **`sales-management` is entitlement-grantable**, unlike `catalog-reference`. A
  vendor's own selling channels are exactly what an organization is provisioned
  for, so ADR 0022's "first exception to ADR 0007's ceiling" stays the only one.
- **`admin` may author channels but still only read the platform vocabulary.**
  The two grants look alike and are not: a `SalesChannel` is tenant-plane, so
  writing one reaches nobody else's data, while `catalog-reference` is shared by
  every vendor.
- **Three Proposed records were checked and none fires.** 0012 needs an operator
  screen reading tenant data; 0013 needs a Postgres-backed tenant domain, and
  `sales` is Mongo; 0014 needs a vendor-authored characteristic.
- **What is deliberately still absent**: use-cases, adapters, a service, any UI,
  and the promotion of `order`/`payment`/`stock` to active. The map is the
  deliverable; the mechanisms are the next iteration — the same division ADR 0022
  made, for the same reason.

## Follow-ups (deliberately out of scope)

- `sales-service` on `:3109`, promoting the `sales` slice to active.
- The back-office selling surface: an implementation package, a `shells-next-sales`
  shell, and the host wiring in back-office-app.
- Settlement reading `commissionFor` when the `settlement` slice is built.
- A `PointOfSaleSession`, if a vendor asks for cash reconciliation.
