# 76. Delivery destination, buyer contact, order numbers, and the buyer's way back to an order

- Status: Proposed
- Date: 2026-11-14
- Area: business
- Read when: storing a buyer's address or contact, numbering an order, or letting a buyer find an order again — contact data lives on the group and the shipment only, a buyer's tax id on the order, and a number never authorizes
- Revised: 2026-11-16 by [ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md) — the buyer's fiscal identity is a third personal record, on the order, and it travels only on a fiscal-document event with `audience: 'none'`, never on `order.*`
- Revised: 2026-11-16 by [ADR 0081](0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md) — payment evidence is personal data removed by the §4 sweep; the receipt capability authorizes one write; the review step offers `link`
- Revised: 2026-11-18 — §6: the access page answers `Referrer-Policy: strict-origin`, not `no-referrer`, which made a browser post the redemption with `Origin: null` and Next refuse it without script (#725)

## Context

A storefront checkout today is four taps and zero fields. That was a good
measure of friction and is now a defect, because the slip that follows it
cannot finish:

- **No destination.** `ShippingOrder` carries lines, a tender and an amount due,
  and no address. A vendor holding a dispatched shipment has nowhere to send
  it, and the courier of a cash-on-delivery order has nobody to collect from
  ([ADR 0070](0070-fulfilment-and-cash-on-delivery.md)).
- **No way back.** The receipt is an `httpOnly` cookie
  ([ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md)) that lives
  `RECEIPT_TTL_SECONDS` = 30 minutes, because it is exactly as long as the cancel
  window ([ADR 0058](0058-the-order-after-payment.md) §5). The read route
  `GET /api/checkout-group/:id/buyer-receipt` verifies the **cancel** window, so
  after 30 minutes nobody — not even the buyer on the same browser — can read
  the order back. A parcel takes days; the buyer has no record of it for all of
  them.
- **No name for an order.** Group ids are the flow's UUID and vendor-order ids
  are `randomUUID` in `placeOrder`. Nobody can read one out to a seller or to
  support.
- **A tender nobody chose.** The cart preselects `card`; a seller who does not
  ship cash on delivery offers a one-option select, and the receipt then says
  "Tarjeta" for a payment the buyer never chose and the simulated provider
  never asked for.
- **A seller that does not ship can be bought from.** `acceptsCod` on the
  published vendor is, in fact, "provisioned for `shipping-order-management`";
  the checkout recipe opens a shipment only when the segment holds that
  entitlement, so a storefront sale from a seller without it is an order with
  no shipment at all.

Two facts constrain every option:

- **The buyer is anonymous.** There is no session to scope a read to, and
  "my orders" is out of reach (ADR 0053's consequences). Whatever brings the
  buyer back must be a capability, stored as a digest, verified where the order
  lives (ADR 0058 §5, §6).
- **The `order` store is platform plane and the predicate is the whole
  boundary** (ADR 0053). Every byte of personal data put there is one missed
  predicate from a leak; every byte put on the bus reaches every subscriber and,
  through the realtime slice, a vendor's open tabs
  ([ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)).

How Guatemalan addresses are written, and what the couriers expect, is in the
`r10c` Notion space (Mercados → Guatemala → Entrega). Courier terms live there
and only there ([ADR 0025](0025-where-planning-and-business-knowledge-live.md));
nothing below depends on a rate.

## Decision

### 1. Personal data lives in two records, and only there

| Record                        | Store / plane         | Holds                                   | Readable by                         |
| ----------------------------- | --------------------- | --------------------------------------- | ----------------------------------- |
| `CheckoutGroup.contact`       | `order` / platform    | name, phone, email, destination, locale | the buyer's capability; an operator |
| `ShippingOrder.destination`   | `fulfilment` / tenant | name, phone, destination — **no email** | the vendor whose database it is     |
| `ProductOrder`                | `order` / platform    | **nothing personal**                    | —                                   |
| `order.*`, `shipping-order.*` | the bus, and push     | **nothing personal**                    | —                                   |

The group is the buyer's receipt and is already never readable by a vendor
(ADR 0069), so it is where the whole contact belongs. The vendor needs to put a
parcel in a courier's hand and nothing else, so the shipment gets a **copy** of
exactly that — not the email, not the `buyerId`. The copy is a fact of the
shipment, not a link: a cross-store reference is an id, and the vendor's
database must not reach into the platform plane at dispatch time.

`ProductOrder` stays free of it because its serialization **is** the payload of
`order.placed` / `order.cancelled` and of the push a vendor's tab receives. The
shipping-order event schema becomes an **explicit pick** of non-personal members
rather than "the shipment as its move left it", so adding `destination` to the
entity cannot put it on the bus. A spec asserts both payloads carry no member
of either value.

> **Revised 2026-11-16 by [ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md)**
> (Proposed). The table above is about **contact** data and stands for it. The
> buyer's **fiscal identity** — `buyerTax`: an id type, a tax id and a name, or
> `cf` when none is given — is a third category with a third home:
>
> | Record                  | Store / plane      | Holds                               | Readable by                               |
> | ----------------------- | ------------------ | ----------------------------------- | ----------------------------------------- |
> | `ProductOrder.buyerTax` | `order` / platform | id type, tax id, name               | the vendor whose order it is; an operator |
> | `order.*`, and push     | the bus            | **nothing personal**, as above      | —                                         |
> | a fiscal-document event | the bus, no push   | the fiscal identity, and only there | a subscribing slice; no browser           |
>
> It is on the order, not the group, because the seller is who must name the
> buyer on an invoice and a vendor never reads a group. That is possible
> without putting it on the bus because ADR 0078 §2 builds `order.placed` and
> `order.cancelled` from their contract, member by member, where this section
> assumed the payload **is** the order's serialization. The spec named above
> extends to `buyerTax`: neither `order.*` nor a push carries a member of it.
>
> The one message that does carry it is a separate fiscal-document event,
> registered with `audience: 'none'`, so the realtime slice's fail-closed
> filter sends it to no browser.

The workflow journal (`workflow`, control plane) holds the checkout's start
input, and therefore the contact, for as long as the engine keeps a journal. No
route reads the journal (ADR 0072). Its retention is open question 5.

### 2. The shape: Guatemala's, not a generic form's

`@r10c/business-ts-order-contracts` (business:policy, so both order and
fulfilment may express themselves in it) declares:

- **`BuyerContact`** — `name` (required), `phone` (required; a Guatemalan number,
  eight digits, stored as E.164 `+502…`), `email` (required, lower-cased), and
  `destination`.
- **`DeliveryDestination`** — `departamento` (INE code, required), `municipio`
  (INE code, required, must belong to the departamento), `zona` (optional,
  integer 1–25), `addressLine` (required free text: colonia, calle/avenida,
  número), `reference` (optional free text: "frente a…", "portón negro").
- **No postal code**, because none is used functionally, and **no country**:
  v1 delivers inside Guatemala.
- **The geography is a code list in that package** — the 22 departamentos and
  their municipios with INE codes — not operator-authored vocabulary. It changes
  by act of Congress, not by an operator's afternoon, and a checkout validating
  against a projection would fail open while the projection was empty.

Both `phone` and `email` are required. The phone is for the courier. The email
is the only channel the platform can reach an anonymous buyer on: SMS has no
provider and no lab sink. The recipient is the buyer. A different recipient is
not built.

Validation runs in the domain (`openGroup`), so an invalid contact refuses the
start with `invalid` problem details whose pointers name the field. The
storefront form gives the same answers first, through the same schema, so no
error reaches a buyer as a raw code
([ADR 0003](0003-i18n-mandatory.md), [ADR 0064](0064-failures-reach-the-slice-shell.md)).

### 3. How the flow carries it

`CheckoutStart` gains `contact: BuyerContact` (required on a storefront
channel, absent at a counter, where a walk-in leaves with their goods) and
`locale`. `order.open-group@3` writes it onto the group. `fulfilment.open@3`
copies name, phone and destination onto the shipment, together with the vendor
order's **number** (§5), so the worklist names an order without a cross-store
read.

A storefront segment whose verified entitlements lack
`shipping-order-management` is refused at start (`vendorDoesNotShip`). The
coordinator already overwrites entitlements with what it verified. A
storefront sale that nobody can ship is now refused, where it used to be an
order that silently never moves.

### 4. Retention: the data leaves when its job is done

- A shipment's `destination` is removed `fulfilment.destinationRetentionDays`
  after it is delivered, returned or withdrawn, by a sweep walking every
  `fulfilment_<organizationId>` database, in the same shape as stock's expiry sweep.
- A group's `contact` is removed once its receipt window has ended **and** every
  order in it is `fulfilled` or `cancelled`, by a sweep in the order slice.
- Removal is an `$unset` plus a `redactedAt` stamp, so a screen can say "the
  buyer's details were removed on …" rather than render an empty field as if
  it had never been asked.

Both dials are configuration rows with seeded defaults. They are product
choices, not courier terms.

> **Revised 2026-11-16 by [ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md)**
> (Proposed). Neither sweep touches `ProductOrder.buyerTax`. A fiscal identity
> is kept for as long as fiscal law requires the sale's record, and that period
> is ADR 0078's open question on retention, not a product dial.

### 5. Numbers: readable, random, and never a credential

`CheckoutGroup.number` and `ProductOrder.number` are eight Crockford base-32
characters, shown `7KQ4-M2XD`. Crockford's alphabet drops `I L O U`, so it reads
aloud without ambiguity. It is each entity's `labelMember` (entifix ADR 0030),
so every list and reference names an order by it. Each is drawn at random in the domain when the record
is opened, with a unique index in the order cell that redraws on a duplicate.
Not a counter, for two reasons: a sequence tells anyone holding two receipts
how many orders the platform took between them, and a counter is a hot row
every checkout contends on.

A vendor sees **only its own order's number**. The receipt shows the group's
number and, per seller, that seller's. Any number derived from the group's
(`…-2`) would tell a seller how many others were in the basket (ADR 0069).

⚠️ **A number is not an id and not a capability.** Ids stay as they are:
the group's is the flow's
([ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md),
ADR 0069). No page renders anything because its address names a number, and
the lookup in §6 answers identically whether or not a number exists. The
number is `filterable` and searchable, so it is the member a back-office search
and a support call use.

### 6. The buyer's way back

**The receipt outlives the cancel window.** The group gains
`receiptEndsAt`, stamped at opening as `placedAt + order.receiptDays`.
Verification splits in two:

- **read** needs a digest match before `receiptEndsAt`;
- **cancel** needs a digest match before `cancelWindowEndsAt`, as today.

The cookie's lifetime is computed from the group's own `receiptEndsAt`, read
back once on settle, so ADR 0058's "two constants, one number" no longer
exists. The receipt page offers Cancel from the stamped `cancelWindowEndsAt`
it already carries, so the "Cancel button that quietly stops working" cannot
occur.

**A one-time access link re-keys the capability.** The group gains
`accessDigest`, `accessExpiresAt` and `accessSentAt`. order-service mints 32
random bytes, stores only their SHA-256, and puts the token only in an email.
It never puts it in a step outcome, so neither the journal nor flow-status ever
holds it. The coordinator never sees the capability, as ADR 0058 requires.
Redemption works like this:

1. The storefront mints a fresh nonce (as checkout does).
2. It sends the token and the nonce's digest to
   `POST /api/checkout-group/access`. The route takes **the token and no
   session**, as `buyer-cancellation` takes the nonce.
3. One conditional write matches `accessDigest` and an unexpired
   `accessExpiresAt`, clears them, and replaces `cancelDigest` with the new
   digest.
4. The storefront reads the receipt back with the new nonce and writes the
   cookie.

Exactly one of two racing redemptions wins. The earlier browser's nonce stops
matching. That is the intended trade: one digest at rest, and whoever controls
the mailbox controls the receipt. The old receipt says it was opened on another
device and offers the lookup.

The link opens a page whose button **posts** the redemption, and the `GET`
alone redeems nothing. Mail scanners that pre-fetch links therefore cannot
spend it. The token rides the **query string**, which the edge's access log is
already forbidden to write (`@r10c/docs-check`), and the page answers with
`Referrer-Policy: strict-origin` — the origin and never the path, because
`no-referrer` makes a browser post the redemption with `Origin: null`, which
Next's Server Action CSRF check refuses.

**The receipt email.** The checkout recipe gains a final stage, `notify`, with
one retriable step, `order.notify-buyer@1`. The step runs after the commit
point, once per group, on order-service. The email is in the group's `locale`
and carries the following:

- the group's number and each seller's number, lines, tender and totals;
- the destination;
- an access link.

A retry after a failed send draws a fresh token and sends again, so delivery
is at-least-once. order-service sends through a `BuyerNotifierTag` port in
`order-management`, implemented by a new `tech:smtp` cell. In the lab that
cell points at Mailpit.

The step calls `POST /api/checkout-group/:id/receipt-mail`, a crossing on its
own permission, `order-management:checkout-group:send-receipt`, rather than
the `write` that opens a group. The link lives `order.accessLinkHours` (24) and
is written against `order.storefrontUrl`; the server is the `smtp.host`,
`smtp.port` and `smtp.from` rows (#587).

**Find my order.** The buyer enters a number (group or seller order) and an
email. The storefront's server action calls
`POST /api/checkout-group/send-access-link` on order-service — the path the
collection verb `send-access-link` derives. The call carries a
**storefront crossing token** plus the derived permission
`order-management:checkout-group:send-access-link`, and has its own
`is_secret` row (`service.storefrontToken`, marketplace-app's
`ORDER_LOOKUP_TOKEN`). The route's guard **names its caller**: it opens to the
storefront's token alone, never to the coordinator's `service.token`, and the
storefront's token opens no other route — entifix's crossing guard gained a
`caller` for exactly this (#588). The route behaves as follows:

- It answers `202` the same way whether or not anything matched, so it is not
  an oracle for numbers or emails.
- A match sends a fresh link **to the email on file**. A link always goes to
  that address, never to one the caller supplied, so knowing someone's number
  and email reveals nothing to the asker.
- `accessSentAt` and `order.accessLinkIntervalSeconds` limit sends to one per
  interval per group, which bounds what the route can do to a victim's inbox.
  The fleet has no other rate limit, and ADR 0058 recorded that.

### 7. The payment choice is explicit

The tender moves from the cart to the review step, where the buyer also gives
the contact. When a seller offers more than one tender, the review shows a
radio group with **none preselected**, and choosing one is required. When it
offers one, the review states it as a fact rather than as a disabled control.
In v1 the card provider is simulated
([ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)),
so the card option says no card will be asked for or charged. A conventions
spec ties that sentence to payment-service still composing the simulated
adapter. The receipt names the tender that was chosen.

### 8. The product page states only what the system enforces

For the seller of the offering, the product page states:

- whether they ship at all (and, if not, offers no Add to cart);
- whether they take cash on delivery;
- that a parcel may be refused at the door, and what happens to a card payment
  when it is (a refund, ADR 0070);
- that a return after delivery is not offered.

It promises no delivery time and no delivery cost until open questions 2 and 3
are answered. Copy is i18n'd in both locales and in the storefront's `tú`
register.

## Open questions

1. **Currency (b0-10).** One page shows US$, GTQ and € with no conversion; the
   receipt already totals per currency (ADR 0053) because no exchange rate
   exists. Options, **undecided**: (a) GTQ only — a vendor prices in GTQ and the
   publication refuses anything else; (b) convert for display — a rate source,
   its staleness and its rounding become a decision, and the charge is still in
   the vendor's currency; (c) per seller as today — honest, and each card and
   receipt says which currency it is in. Interacts with the COD cap, which is a
   GTQ figure.
2. **Who pays delivery, and is it shown at checkout?** Notion's Entrega page
   holds this open. Until it is answered there is no delivery line at checkout;
   the product page says nothing about cost.
3. **Is a delivery time promised?** Notion asks whether same-day is a commercial
   promise; the 14-day delivery window (ADR 0070) is a timeout, not a promise,
   and must not be shown as one.
4. ~~**The buyer's NIT.** Notion's checkout page notes a tax identifier is needed
   for a valid invoice. Fiscal documents are out of v1 scope; if that changes,
   the NIT is a third personal field and follows §1.~~ **Answered 2026-11-16 by
   [ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md):**
   it is stored on the order as `buyerTax` and travels only on a
   fiscal-document event — see the note on §1.
5. **The journal's retention.** The workflow journal holds the start input, and
   with it the contact, for as long as the engine keeps journals, and entifix's
   engine has no purge today. Options: an entifix purge of completed flows
   after a dial (preferred: the store owner's job), or a start input that
   carries only what the steps need and lets `open-group` be the one step that
   sees the contact (it still journals that step's input).
6. **Whether couriers validate addresses against their own zone catalog**
   (Notion's "Verificar"). §2 keeps `zona` a range rather than a per-municipio
   list for that reason; a courier integration that needs one tightens it.

## Consequences

- A checkout takes one form. The four-tap path is gone for the storefront and
  unchanged at the counter.
- Personal data has exactly two homes, a schedule for leaving each, and a spec
  keeping it off the bus. (Contact data, that is: the fiscal identity is a
  third, on the order, as the note on §1 records.)
- The buyer can come back for as long as `order.receiptDays`, from any device
  that can open their email.
- order-service becomes the fleet's first mail sender, and the storefront holds
  a second crossing token (for order-service), its own `is_secret` row.
- **Revises in place** [ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md)
  (the receipt outlives the cancel window; "the receipt is per-browser" becomes
  "per-browser until re-keyed from the buyer's email"),
  [ADR 0058](0058-the-order-after-payment.md) §5 (read and cancel lifetimes
  split; the cookie's lifetime is the group's stamp, not a constant),
  [ADR 0069](0069-a-checkout-group-of-per-vendor-orders.md) (the group holds the
  contact; the tender is chosen at review) and
  [ADR 0070](0070-fulfilment-and-cash-on-delivery.md) (the shipment carries a
  destination; a storefront seller must ship).

## What this does not build

SMS or WhatsApp notification · status emails after placement (dispatched,
delivered) · a recipient other than the buyer · international delivery · a
buyer account or "my orders" · rate limiting beyond the per-group interval ·
delivery fees · courier integration.

## Trigger

M19's first implementation issue lands. The record moves to Accepted in M19's
close-out, after the live pass.
