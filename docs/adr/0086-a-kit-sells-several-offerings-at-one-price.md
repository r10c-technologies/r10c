# 86. A kit sells several offerings at one price

- Status: Proposed
- Date: 2026-11-26
- Area: business
- Read when: selling a bundle of products at one price

## Context

A phone-accessory shop sells a case and a screen protector for the same model
as one product at a kit price. A hardware store sells an installation kit:
a box of screws, anchors and a drill bit. Each component is also sold on its
own, from the same shelf. Selling the kit must take one of each from the
same stock a loose sale takes from. Otherwise the kit sells a case that was
already sold loose.

Two mechanisms already exist and neither fits. A presentation
([ADR 0082](0082-an-offering-is-sold-in-a-unit-with-a-step.md) §7) draws on
**one** base. A variant ([ADR 0085](0085-variants-are-offerings.md)) is one
offering with stock of its own. The checkout flow holds stock per order line
([ADR 0065](0065-use-case-resolution-and-the-routing-slip.md)). The stock
fragments take one item per call.

## Decision

### 1. A kit is an offering whose components are other offerings of the same vendor

`ProductOffering.kitComponents` lists `{offeringId, quantity}` rows, at most
ten, each component once. `kitSize` holds their count: a composition is never
queried, so the count is the one fact about a kit that a query can ask.

Both members are server-owned. Only the `set-kit` verb writes them
(`POST /api/product-offering/:id/set-kit`, permission
`product-configuration-management:product-offering:set-kit`), at the revision
it read ([ADR 0079](0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md) §4).
A save carries them across. An empty list makes the offering a plain one
again.

The kit keeps its own name, page and price record. Settlement, commission and
tax see the line's amount, so nothing downstream of the order learns the
word.

### 2. One level, one stock rule each

A kit is sold in `UN` and holds no stock of its own. It is not a variant, not
a presentation, not another offering's stock base and not another kit's
component. A component is in the same tenant catalog, sold in `UN`, and is
not a kit. A component **may** be a presentation: it takes from its base, as
it does when sold loose.

`draw-on-stock`, `set-variant` and `set-sale-unit` refuse a kit. Refusals
answer `kitInvalid` with a closed `problem`.

### 3. Publication resolves what one kit takes from each component

`set-kit` checked the components, but nothing locks them, so publication
checks them again. Each component must still exist, be sold in `UN`, not be
a kit, and be **published**. A kit whose case was taken down would sell a
case nobody offers.

The snapshot carries `kitComponents` as `KitStock` rows: the component, how
many one kit holds, and `stockOfferingId`, `stockUnit` and `stockQuantity`,
which is what one kit takes from stock. A presentation component resolves to
its base, with its factor multiplied in. The member is absent, never `[]`, on
an offering that is not a kit.

### 4. One hold per component, keyed `<kit>~<component>`

The coordinator drops whatever the caller sent and states what the **whole
line** takes from each component: `kitLineStockOf(quantity, kit)`, computed
once. The flow catalog's `linesOf` expands a kit line into one entry per
component, keyed `<kitOfferingId>~<componentId>`, with that component's stock
as the parameters. So `stock.reserve`, `convert`, `release` and `restore`
are unchanged. A component sold loose in the same basket keeps its own key,
and both compete for one balance in one conditional write
([ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)).

Line keys must be distinct, or two holds share a step name and an idempotency
key. A vendor's part that names one offering on two lines is refused, and the
till merges repeated lines before it starts the flow.

### 5. The order and the shipment copy the components

`OrderItem.kitComponents` and `ShippingLine.kitComponents` copy what the line
took ([ADR 0079](0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md)
§3). A cancellation, a refused parcel and a return rebuild the lines from the
copy, so each component goes back as it was taken, whatever the kit holds by
then. The shipment's copy is the packer's list.

### 6. The row classes are vocabulary

`KitComponentRow` and `KitStockRow` live in `sales-vocabulary`, beside
`StockSource`. Four domains hold them: the offering, the projection, the
order and the shipment. A domain may reach the vocabulary, but never another
domain.

## Consequences

- A kit and its loose components compete for one balance, and the ledger
  decides. A kit never oversells a component.
- A failed hold on any component fails the line, and the flow compensates the
  holds already taken, exactly as for two loose lines.
- A component edited after the kit was published changes nothing until the
  kit is published again. An order copies what it took.
- A kit's availability on the storefront is a hint: available only when every
  component's projection is.

## Alternatives considered

- **A kit with stock of its own**, assembled ahead of time. That is
  manufacturing ([Discussion #610](https://github.com/r10c-technologies/r10c/discussions/610)).
  It would need assembly movements, and a shop that bundles at the counter
  keeps no assembled stock.
- **A multi-item reservation route.** One call holding several items would be
  atomic per kit. But it changes the stock slice's contract, its idempotency
  and its compensation for something the per-line steps already express. The
  flow's compensation makes the per-component holds all-or-nothing anyway.
- **A price rule on the cart** ("buy these two, pay less"). That is a
  promotion, not a product. It has no page, no name and no line on the
  receipt.
