# 82. An offering is sold in a unit with a step, and a product may reference what it fits

- Status: Proposed
- Date: 2026-11-21
- Area: business
- Read when: multiplying a price by a quantity, selling by the metre, yard or box, or pricing below a centavo — a quantity is a scaled integer, a line's total is computed once, and a sale never grows after it is placed

## Context

Two of the three MVP verticals sell things that are not counted one by one:
cable by the metre, fabric by the yard, screws by the hundred. The fleet models
none of it.

### What the code does

- **A quantity is a bare number, read three ways.** A checkout accepts a
  positive integer (`Schema.Int` in
  `packages/shells/effect/flow-catalog/src/catalog.ts`), stock holds any finite
  positive number (`isReservableQuantity`), and `order.*` carries
  `Schema.Finite`. A fraction is refused at one door and stored at another.
- **The cart changes what was typed.** `withQuantity` floors a fraction and
  clamps at `MAX_QUANTITY = 99`, both silently
  (`packages/shells/next/marketplace/src/lib/cart/cart-state.ts`). A request for
  3.5 becomes 3, and a box's worth of loose screws cannot be bought at all.
- **The total is multiplied wherever it is needed.** `amount * quantity`
  appears in the order's flows, the checkout recipe, the counter sale,
  settlement's commission, and the storefront's and the till's screens. That is
  harmless only while both are integers and the price is for exactly one unit.
- **A price is whole centavos for one unit.** An offering publishes one price
  (`pageSize: 1` in `transition-offering.ts`).
- **What a product fits is built.** `ProductSpecification.fitsDeviceModelIds`
  references the platform's `DeviceModel` vocabulary, with `universal` as an
  explicit value (#641).

### What the evidence says

Desk research of 2026-11-21: public catalogs of Guatemalan merchants, plus
public rules. The merchants and the call script are in Notion
([ADR 0025](0025-where-planning-and-business-knowledge-live.md)). **No merchant
was interviewed.**

| Finding                                                                                                  | Strength                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Cable is priced per metre, and the same kind of cable per 100 m box                                      | read on merchants' pages              |
| Fabric and synthetic leather sell by the yard and by the roll                                            | read on merchants' pages              |
| One fabric seller starts at one yard, another sells whatever is needed, so a minimum is not a step       | read on merchants' pages              |
| Screws are quoted per hundred, at a price below one centavo each                                         | search excerpt; the page was not read |
| Volume prices exist in hardware and fabric; in phone accessories the wholesale price follows the account | read, one or two merchants each       |
| A natural hide has no uniform area                                                                       | read, a supplier outside Guatemala    |
| How a Guatemalan leather shop measures, cuts and charges                                                 | **no data**                           |

Public rules that bound the answer:

- **FEL** ([Reglas y Validaciones 2.1](https://portal.sat.gob.gt/portal/descarga/14852/reglas-y-validaciones/97423/fel_reglas_y_validaciones-3),
  October 2026): an item's `Precio` equals `Cantidad × PrecioUnitario` (2.3.2.3)
  within one centavo (5.2). The
  [DTE schema](https://github.com/notificacioneselectfel/Catalogo-FEL/tree/main/XSD)
  allows ten decimals in both factors and **three characters** in
  `UnidadMedida`.
- **Consumer law** ([Decreto 006-2003](https://faolex.fao.org/docs/pdf/gua207049.pdf),
  art. 71 a, as published): charging more than the price shown, informed or
  published is an infraction.

## Decision

### 1. A unit comes from a closed vocabulary, and the unit fixes the scale

`SaleUnit` lives in `@r10c/business-ts-sales-vocabulary`, where every domain
that needs it may reach it.

| Units                                                       | Scale | `quantity: 3500` means |
| ----------------------------------------------------------- | ----- | ---------------------- |
| `UN`, `PAR`                                                 | 0     | 3,500 pieces or pairs  |
| `M`, `YD`, `FT`, `M2`, `FT2`, `DM2`, `KG`, `LB`, `L`, `GAL` | 3     | 3.5 of the unit        |

A code has at most three characters, so it **is** the FEL `UnidadMedida`. A
unit's scale is never edited, because that would change what every stored
quantity means. A box, a dozen or a roll is not a unit: it is a presentation
(§7). A quintal is `LB` with a step of 100.

### 2. A quantity is an integer in the unit's scale, everywhere

Cart, checkout input, reservation, movement, stock counters, order line,
shipping line and event all hold the scaled integer, typed `Schema.Int`. A
decimal exists only where a person types or reads one, and one pair of
functions in the vocabulary converts it, from and to a **string** and never
through a float.

The default unit is `UN`, whose scale is 0, so a counted product's quantities
mean what they mean today.

### 3. An offering states unit, step and minimum, and nothing adjusts a quantity

`ProductOffering` gains `saleUnit`, `quantityStep` and `quantityMinimum`, the
latter two in the unit's scale, the minimum a multiple of the step. All three
are required in the publication snapshot: they decide money, so
[ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md)'s
optional-member rule does not reach them.

- A quantity is valid when `quantity >= quantityMinimum` and
  `quantity % quantityStep === 0`.
- An invalid one is **refused, never rounded, floored or clamped**:
  `quantityBelowMinimum`, `quantityOffStep` (which names the nearest valid
  quantity on each side) or `quantityAboveMaximum`. The maximum is 9,999 whole
  units per line and replaces the cart's 99.
- What stands for no quantity at all (empty or ambiguous text, or a number
  that is no integer in the scale) is refused `quantityUnreadable`.
- The storefront and the till check it to help a person. The checkout and the
  counter sale check it again against the published projection they already
  re-price from
  ([ADR 0056](0056-the-counter-sale-is-the-checkout-saga.md)), and that check is
  the decision.
- Step and minimum may change, effective at the next publication. The unit is
  set by `set-sale-unit` until the first publication and never afterwards:
  selling in another unit is another offering.
- The cart's badge counts lines. A sum of metres and pieces means nothing.

### 4. The ledger states its own unit

`StockItem`, `StockMovement` and `Reservation` carry `unit`. The first movement
fixes the item's, and the conditional write that moves a counter also matches
on it, so a movement or a hold in another unit is refused `unitMismatch` rather
than added to the total.

An offering whose unit was changed after stock was received keeps that stock in
the old unit, and its first hold is refused `unitMismatch`: the catalog cannot
read the stock store to prevent it, so the vendor creates another offering.

Stock checks that a quantity is an integer of the right sign and nothing else.
The step is the catalog's rule for selling: a vendor must be able to write off
0.137 m, and a leftover below the minimum is stock that exists and cannot be
sold.

[ADR 0010](0010-stock-ledger-reservations-and-concurrency.md) is otherwise
untouched. The counters still move by `$inc`, now exact because the operands
are integers.

### 5. A price says how many units it buys

`ProductOfferingPrice` gains `pricePer`, one of `1`, `100` or `1000` whole
units, default `1`. `amount` stays integer minor units. Q7.50 the hundred is
`amount: 750, pricePer: 100`, shown as it is quoted.

### 6. A line's total is computed once, rounded half up, and copied

```
lineTotal = roundHalfUp(amount × quantity / (pricePer × 10^scale))
```

- One pure function in the vocabulary, in `bigint`, with the same half-up rule
  the tax policy uses.
- The coordinator computes it at placement. The line stores `unit`, `quantity`,
  `amount`, `pricePer` and `lineTotal`, and
  [ADR 0079](0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md)
  §3 holds: nothing on the line is resolved again.
- **Every reader sums `lineTotal`, and none multiplies.** Order total, capture,
  collection, receipt, commission subtotal and tax gross all read the stored
  member. A preview before placement calls the same function.
- The three roundings stay separate: a line's price is rounded per line (here),
  IVA once per document
  ([ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md)
  §6), commission once per vendor on the subtotal
  ([ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md) §6).
- A line that rounds to zero is refused `lineBelowOneMinorUnit`.

It certifies by construction. `Cantidad` is the quantity with at most three
decimals, `PrecioUnitario` is `amount / (100 × pricePer)` with at most five,
and half-up leaves `Precio` within half a centavo of their product.

### 7. Presentations are in: another offering drawing on one stock

A presentation is an offering of its own, with its own name, price and page,
that states `stockOfferingId` and `stockFactor`: how many scaled base
quantities one of it takes. It is sold in `UN`. A 100 m roll of a cable kept in
metres has `stockFactor: 100000`.

- One level only: the base offering has no `stockOfferingId`, and both belong
  to one vendor.
- Both members travel in the snapshot. The coordinator multiplies and reserves
  on the base, so a box and loose units compete through ADR 0010's one
  conditional write and nothing is read first.
- The line copies `stockOfferingId` and `stockQuantity`. A cancellation or a
  return restores what was copied, so a factor edited later corrupts no past
  order.

### 8. Tiers are in: all units, per line

A price may hold `tiers[]` of `{ from, amount }`: `from` a valid quantity,
strictly ascending, `amount` strictly lower than the one before, all under the
price's own `pricePer`.

The highest `from` not above the quantity prices the **whole line**. Offerings
do not pool, presentations included. The line copies the amount it was sold at
and the `from` that gave it. A larger quantity can therefore cost less than a
slightly smaller one, as it does at a counter, and the product page shows the
table.

If time runs out before 20 December, §8 (#674) is cut first and §7 (#673)
second. §1–§6 (#672) depend on neither.

### 9. A sale never grows after it is placed

Out of the MVP: cut, measure, and charge the difference. The amount is fixed at
placement, where the capture, the payment link, the tax and the DTE all take it
from, and charging more than was informed is what art. 71 a penalises.

- A seller who cuts long gives the excess away and may record it as an
  adjustment movement.
- A seller who cannot supply the quantity cancels
  ([ADR 0058](0058-the-order-after-payment.md)).
- A hide or a remnant is published as a measured piece: `UN`, its area in its
  name, priced whole, stock 1.

### 10. A product references what it fits, on the specification

As built in #641, and kept: the reference is an id list on
`ProductSpecification` into a platform-plane vocabulary, versioned with the
specification and copied into the snapshot, with `universal` explicit. An
offering does not carry its own list, so the planned `set-device-fit` verb on
`product-offering` is not built. Fitting anything other than a phone takes
another vocabulary and is out until a vertical needs it.

## Consequences

**To build, #672:**

1. The vocabulary: units, parse and format, validity, `lineTotal`, with
   property tests over the FEL tolerance.
2. Members on offering, price, snapshot, projection, the three stock records,
   order line and shipping line. The event payloads and the fragments that
   carry a quantity bump their versions. Seeds change and the lab is reset:
   there is no dual read.
3. Every `amount * quantity` is replaced, and a convention check fails a new
   one. This is the dangerous part: one missed site charges a measured line a
   thousand times over.
4. A quantity field and cell that know the scale, on the storefront, the till
   and stock's screens. entifix formats money from metadata and has no
   equivalent for a scaled quantity, so a generic table would print `3500` for
   3.5 m. That gap is filed in entifix or closed by a cell before the screens
   ship.
5. The capability register loses `set-device-fit`, and `set-sale-unit` becomes
   `implemented`.

**Then** #673 (§7) and #674 (§8).

**Costs accepted:**

- An integer alone is ambiguous: `3500` needs its unit beside it, in every
  payload and every log.
- Stock is a total and not a set of pieces. Ten yards may be two pieces of
  five, so an order for eight can be accepted and not be cuttable in one
  length. The seller cancels. Lots are out.
- A unit finer than a thousandth, such as a sixteenth, cannot be expressed
  exactly.
- The specific taxes some goods carry (cement has one in FEL 2.16) are not
  modelled by a unit. The sample stores avoid those goods until an accountant
  answers.

## Alternatives considered

- **A decimal or float quantity.** `$inc` of 0.1 accumulates error, and the
  reservation's `>=` then refuses the last piece that is really there.
- **One scale for every unit.** A lamp becomes `1000`, every seed, fixture and
  screen changes meaning, and a missed division is wrong for every product
  rather than for the measured ones.
- **A quantity counted in steps.** Editing the step would silently re-denominate
  the ledger and every open cart.
- **A scale chosen per offering.** A second thing to copy and to get wrong,
  with no case the two fixed scales do not cover.
- **Sub-centavo `amount`.** It changes the meaning of money in every store to
  serve one way of quoting.
- **A presentation as a list inside the offering.** Cart, price, tiers,
  publication and URL are all keyed by the offering id. Each would gain a
  second key.
- **Graduated tiers.** The line would no longer have one unit price, which the
  DTE item requires.
- **Adjust after measuring.** A second capture or link, a re-stated tax, a
  consent step and a wait, on evidence nobody has collected yet (§9).

## Open questions

1. How does a Guatemalan leather shop sell natural leather: the unit, the
   smallest cut, and what it charges when the cut runs long? (#644)
2. Do remnants exceed one sale in five, which would reopen them as inventory?
   (#644)

## Trigger

Building does not wait for either answer. **Accepted** when #672 is merged and
two or three leather merchants have answered question 1 (#644). If two or more
charge what was measured, §9 is reopened by a record of its own before the
leather sample store is shown to a customer. §1–§6 stand either way, since
hardware needs them.
