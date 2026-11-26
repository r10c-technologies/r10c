# 85. Variants are offerings

- Status: Proposed
- Date: 2026-11-25
- Area: business
- Read when: selling one product in several colours or sizes

## Context

Two of the three verticals the first demo is for sell one product in
several versions. A phone-accessory shop sells one silicone case in black,
blue and pink, with stock per colour (CAP-CATALOG-VARIANT-01). A leather
supplier sells one rubber sole in sizes 36–44 and in black or brown
(VARIANT-02). The leather demo script asks for "2 pairs of size-40 brown
soles". Until now the sample stores worked around it: "Cuerina negra" and
"Cuerina café" were two unrelated products. A buyer looking at one could not
see that the other existed.

The spec issue (#322) asked two questions first. What does "variant" mean?
And is a variant a stock item (ADR 0010)? Discussion #621 carried the build.

"Variant" already means two things in this repository. A **product variant**
is a version of a product a buyer can buy. A **control variant** is how a UI
control is drawn (`compact`, `full`). This record is about the first; the
second keeps its name in the design system.

The fleet already sells everything a variant needs by the offering:

- an offering has its own price row, with tiers (ADR 0082 §8);
- it has its own stock item, and a hold is taken on its id (ADR 0010);
- an order line and a shipping line copy its id, name and price, and the
  flows reserve, release and restore against that id (ADR 0069, ADR 0070);
- settlement folds per order line (ADR 0057).

ADR 0082 §7 met the same question for presentations: a box of screws is
another way to sell the same thing. It answered by making the box an offering
of its own, and recorded "a presentation as a list inside the offering" as
the rejected alternative. That decision kept the cart, the coordinator and the
order untouched.

## Decision

### 1. A variant is an offering of the same product

A product's variants are the vendor's `ProductOffering`s that pin a version of
the same specification **series** (`specKey`, ADR 0079 §1) and each carry
`variantValues`. The series is the product, not the version record. Revising
the specification re-pins a variant without taking it out of its group.

Each variant is a whole offering: its own name, price, tiers, stock, page and
order line. Nothing downstream of the catalog learns the word. The cart, the
coordinator, the order, fulfilment, settlement and the stock ledger are
unchanged.

### 2. The axes are a closed list

`VARIANT_AXES = ['color', 'size', 'finish', 'capacity']`, in
`@r10c/business-ts-sales-vocabulary`. An axis is labelled through the i18n
catalog, so two vendors' `color` is one facet rather than `color` and
`colour`. The values are the vendor's own words.

A variant takes at most three axes, each value non-empty and at most 40
characters. Every variant of one product uses the same set of axes. No two
variants take the same combination, compared accent- and case-blind
(`variantKeyOf`), so `Café` and `cafe` are one colour.

Trigger: when ADR 0014's characteristic dictionary is built, the axes move
onto its terms and the closed list goes.

### 3. A verb sets it, and the combination is claimed in the same write

`set-variant` (`product-configuration-management:product-offering:set-variant`)
is the only writer of `variantValues`. A save carries the stored value across
(`preserveOfferingLifecycle`). A save that moves a variant to another product
is refused as `variantInvalid` / `productChanged`.

The verb reads the product's other variants so it can say which rule a choice
broke (`axesMismatch` or `combinationTaken`). Reading first cannot stop two
browser tabs taking one colour at the same moment, so the catalog cell also
claims the combination in the same transaction as the offering. It writes
one document per combination, `slot = <series>|<key>`, unique, in
`product-offering-variant-slot`. The loser of the race is answered
`combinationTaken`.

A claim only counts while its holder still holds that combination. A claim
left behind by a deleted offering passes to the next offering that asks.

The claim is a separate collection, not a field on the offering, because a
save replaces the offering document whole and would drop a field it does not
know.

### 4. A presentation is never a variant

A presentation draws on its base's stock (ADR 0082 §7); a variant holds its
own. `set-variant` refuses a presentation (`presentation`), and `draw-on-stock`
refuses a variant (`isVariant`).

### 5. An offering may hold its own pictures

An offering gets an optional `media` composition, checked by the same
`mediaRefusal` on its save. The publication snapshot uses the offering's
pictures when it has some, and the specification's otherwise. A black case is
not the blue one's photo. ADR 0061 still governs what a picture is.

### 6. The snapshot carries the group

The publication carries `specKey`: the series, or the version's own id when
it has none. It also carries `variantValues`, which is absent, never `[]`, on
an offering that is no variant (ADR 0049). The projection writes
`variantGroup`, which is the `specKey` when the offering is a variant and
absent otherwise.

### 7. Listings keep one card per offering; the product page picks

A search for "negra" must land on the black case. Baymard's finding is that
collapsing variants into one card hurts finding them. So a listing keeps one
card per offering, with paging and facet counts unchanged.

The product page reads its siblings (`vendorId` plus `variantGroup`) and
renders a picker. Each axis is a list of links to the sibling that keeps most
of the current choice. The current value is marked `aria-current`. A sold-out
value says so in its own accessible name. Every choice is a real page, so the
picker needs no script.

The cart and the checkout review name a line's variant beside the offering's
name. An order line copies the name alone, so a vendor names a variant
("…, azul").

## Consequences

- A product in four colours is four offerings, each priced and stocked
  separately. That is what the verticals asked for: stock per colour.
  Repricing every colour at once is four edits until a bulk verb exists.
- Every variant's offering name is the vendor's. The order receipt says only
  what that name says, which is why the seeds and the import name each
  variant.
- The axes are fixed in code. A vendor needing a fifth axis is the trigger in
  §2, not a free-text field.
- The variant slot is one more document per variant in the tenant `catalog`
  store, written and freed in the variant's own transaction.

## Alternatives considered

- **Options and variants inside one offering** (Shopify's model:
  `options { name, values }`, `variants { selectedOptions, price,
  availability }`). The cart line, the reservation, the order line and the
  settlement fold would all need a variant key beside the offering id. That is
  ADR 0082 §7's rejected alternative again, for the same reasons.
- **One card per product in listings.** It hides the matching variant from a
  search and needs the projection to elect a lead per group under concurrent
  publications.
- **Free-text axis names.** They are not comparable across vendors. That is
  the problem ADR 0014's dictionary exists to solve, and it is not built.
