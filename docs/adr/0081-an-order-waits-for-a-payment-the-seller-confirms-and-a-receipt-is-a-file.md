# 81. An order waits for a payment the seller confirms, and a receipt is a file

- Status: Proposed
- Date: 2026-11-16
- Area: business
- Read when: a buyer pays off-platform or a file is stored — wait after the commit point, the order status arbitrates, a receipt has a deletion date

## Context

The MVP flow is: cart → pending payment → the seller sends a payment link →
the buyer pays and sends a receipt → the seller confirms → guide → status. That
is how the three verticals sell today. A small Guatemalan merchant generates a
link with their acquirer's remote-payment product, sends it over WhatsApp, and
waits for a screenshot (`verticals-research.md` §1). None of it fits the fleet
as built.

- **A tender is taken at checkout or at the door, and never later.**
  `OrderTenders` is `['card', 'cash', 'cod']`
  (`packages/business/ts/sales-vocabulary/src/values/order-tender.ts`).
  `payment.capture@3` is the checkout's pivot and excludes only `cod`
  (`packages/business/ts/payment-management/src/fragments/payment-fragments.ts`).
  A basket with no capture passes `flow.commit@1` and converts its holds at
  once (`packages/shells/effect/flow-catalog/src/catalog.ts`, `checkoutRecipe`).
- **A hold lives 900 seconds.** `stock-service / reservation / ttlSeconds` is
  `900` (`apps/config-service/src/db.ts`). `takeReservation` stamps
  `expiresAt = now + ttl` for every hold, and nobody states it per hold
  (`packages/business/ts/stock-management/src/use-cases/stock-flows.ts:43-46`).
  A sweep releases expired holds. A conversion of a hold that already expired
  answers `200` and **writes no movement** (`stockConvert`'s comment;
  [ADR 0070](0070-fulfilment-and-cash-on-delivery.md)).
- **The engine refuses a wait before the commit point.** The slip validator
  has the rule `WaitBeforeCommit`: "waits before the commit point, holding
  uncommitted state for as long as it waits" (`@entifix/business` 0.22.4,
  `dist/flow/validate.js`). Today's only waits are the delivery flow's, after
  its dispatch pivot. They are signalled by transaction-service consuming
  `shipping-order.*`, correlated by shipment
  (`tools/slices/src/slices/transaction.slice.ts`).
- **`paid` is written only by a capture's consequence.** order-service's
  `payment.captured` consumer moves `pending → paid` with a conditional write,
  and leaves an order no longer `pending` exactly as it is
  (`packages/implementation/order/mongo/src/product-order-store.ts:387-388`,
  `packages/shells/effect/order/src/payment-status.ts`).
- **Settlement assumes the platform holds card money.** `fold-sale.ts:81`
  writes `collectedBy = paymentMethod === 'cod' ? 'vendor' : 'platform'`.
  Voiding an order cancelled with nothing collected is keyed on `cod`
  (`packages/business/ts/settlement-management/src/ports/settlement-ports.ts:22`).
- **Nothing stores a file.** Product media is a reference, `{ url, alt }`,
  "never bytes we store"
  ([ADR 0061](0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md);
  `packages/business/ts/catalog-contracts/src/values/media-reference.ts`). A
  search of `.entifix/packages/ts` for `multipart` finds nothing.
  `apps/marketplace-app/next.config.js` sets no server-action body limit, so
  Next's default applies, and that default is 1 MB.
- **The buyer is anonymous, and their way back is not built yet.** The group
  holds `cancelDigest` and `cancelWindowEndsAt` only
  (`packages/business/ts/order-management/src/entities/checkout-group/checkout-group.entity.ts:34-40`).
  The receipt read uses the `x-cancel-nonce` header against the **cancel**
  window, 30 minutes (`order-service / order / cancelWindowSeconds`).
  `receiptEndsAt`, the access link and order numbers are
  [ADR 0076](0076-delivery-destination-buyer-contact-and-the-way-back.md),
  Proposed, built by M19.
- **A shipment carries no courier and no guide.** `ShippingOrder` holds
  status, lines and amount due
  (`packages/business/ts/shipping-order-management/src/entities/shipping-order/shipping-order.entity.ts:41-53`).
  ADR 0070's dials table says "courier: manual (v1)".

## Decision

### 1. A new tender, `link`: paid outside the platform, confirmed by the seller

`OrderTenders` gains **`link`**: the buyer pays this seller through a link the
seller sends, and the seller confirms the payment. `PaymentMethods` gains
`link` too. The platform never saw a card, so a reconciliation must not read
one as `card`.

The recipe never compares the literal. It asks
`confirmedBySeller(tender)`, a predicate exported beside `OrderTenders` that is
true for `link` alone. A bank deposit with a slip is the same shape. Adding
`transfer` as a tender later is then a vocabulary edit plus copy, and needs no
new recipe branch.

A seller offers `link` the way a seller offers `cod`. The organization
gains a member, `acceptsPaymentLink`, authored by the vendor's `admin`
through the verb `set-payment-link-acceptance` on the organization page.
auth-service announces it on `organization.announced`, which plan 4.3 already
widens, and the published vendor carries it as `acceptsLink`. It is not an
entitlement, because an entitlement names a domain and not a tender. When
tenant configuration lands
([ADR 0079](0079-a-published-specification-is-versioned-and-a-save-names-the-revision-it-read.md)
§5), the setting moves there. The
coordinator overwrites the caller's claim with what it verified, as it does
for `acceptsCod`. The buyer picks it at review, per seller, with nothing
preselected (ADR 0076 §7).

### 2. Its path through the checkout: commit, then wait

A wait cannot sit before the commit point, and it should not. Before the
commit point every step is compensated if a later one fails. A 48-hour wait
there would leave a basket's card capture hostage to a link that may never be
paid. So a `link` segment is committed like a `cod` one and **then** waits:

| Stage (per segment unless noted) | `link` segment                                                                                                                                      | Unchanged for `card`, `cash`, `cod`   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `group` (once)                   | `order.open-group`                                                                                                                                  | yes                                   |
| `place`                          | `stock.reserve@3` with `holdSeconds` stated by the coordinator (§3); `order.write`                                                                  | `stock.reserve` holds for the default |
| `pay` (once)                     | excluded from `payment.capture`; a basket that is all `link`/`cod` passes `flow.commit@1`                                                           | yes                                   |
| `fulfil`                         | `order.await-payment@1` — `pending → awaiting-payment`, stamping `paymentDueAt`                                                                     | convert, confirm, open as today       |
| `await-payment` (new)            | wait `order.payment-decision@1`, outcomes `confirmed` \| `cancelled`, correlation `payment:<groupId>:<vendorId>`, timeout §3, `onTimeout: 'strand'` | not composed                          |
| `paid` (new, on `confirmed`)     | `payment.record-confirmation@1`, `stock.convert@3`, `order.confirm@2`, `fulfilment.open@3`                                                          | not composed                          |
| `unpaid` (new, on `cancelled`)   | `stock.release@1`                                                                                                                                   | not composed                          |

New fragments:

- **`order.await-payment@1`** (retriable) moves the order to a new status,
  `awaiting-payment`, and stamps `paymentDueAt`. That status is the one
  record of "this order is promised and unpaid". `pending` keeps its meaning,
  a flow in flight that nobody else may touch
  ([ADR 0058](0058-the-order-after-payment.md) §2).
- **`order.payment-decision@1`** (wait) is answered by the two events of §4.
- **`payment.record-confirmation@1`** (retriable, crossing token) writes the
  `Payment` with method `link`, `providerReference` set to the seller's
  authorization number, and one `PaymentAllocation` for the order. It
  announces `payment.captured`. It is not a pivot. The money moved at the
  acquirer, and this step records it after the slip's point of no return, so
  it rolls forward like `payment.record-collection@1` does for `cod`.
- **`stock.release@1`** (retriable) calls the same `DELETE
/api/reservation/:id` the reservation's compensation calls. A compensation
  cannot run after the commit point, but this route is already total: it
  answers `200` whether the hold was released, swept or never there. It only
  needs a retriable fragment to be named from a committed branch.

In a mixed basket, the card sellers' segments convert and ship while the
`link` segments wait. The flow therefore stays open for up to the window. The
storefront settles a checkout on **`flow.waiting`**, which a wait past the
commit point announces ([ADR 0073](0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md)).
It must not wait for `flow.completed`, as `settleDecision` does today, or a
buyer would watch a spinner for two days.

### 3. The hold window is one number, stated by the coordinator

One configuration row, `transaction-service / checkout / paymentWindow`, set
to 48 hours (Q16), and one grace row, `paymentWindowGrace`, set to 1 hour. The
coordinator states both into the flow, as it states the delivery windows
(ADR 0070). They are never a caller's to say.

- `order.await-payment@1` receives `paymentWindowMs` from its parameters and
  stamps `paymentDueAt = now + paymentWindow` when the step runs — a slip
  states no clock, so the same start always composes the same slip.
  order-service holds no row of its own for it. Two rows meaning one number
  is the trap ADR 0058 §5 recorded for the receipt cookie.
- `stock.reserve@3` receives `holdSeconds = paymentWindow + 2 × grace`.
  stock-service refuses more than `stock-service / reservation /
maxHoldSeconds` (`invalidBody`), because a crossing caller stating an expiry
  must be bounded by the store that honours it. Without `holdSeconds`, the hold
  keeps the 900-second default.
- The wait's timeout is `paymentWindow + grace`, and on timeout it **strands**.

⚠️ **The hold must outlive the decision, or a confirmed order oversells.** If
stock's sweep released a hold before the seller confirmed, `stock.convert`
would answer `200`, write no movement, and the goods would be sold twice. The
ordering above makes that unreachable: the order expires at the window, the
wait strands at window + grace, and the hold expires at window + 2 × grace.
The sweep stays as the backstop for a flow that died. The wait strands rather
than deciding because the order's status (§4) is the authority. A timeout that
fires means a signal was lost, and that is a case for a person.

The cost is the trade Q16 accepted: a basket that is never paid takes its
stock off sale for two days. The dial is where to shorten it.

### 4. Confirm against expiry: the order's status is the only arbiter

Both outcomes are **one conditional write on the order, on the status it
leaves**, the rule ADR 0070 set for shipments. Exactly one of a confirmation
and an expiry wins, at the store, whatever the timing:

| Move              | Who                                                                      | Write                                                                                                                       | Announces                 |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `confirm-payment` | the vendor, by session: `order-management:product-order:confirm-payment` | `awaiting-payment → paid`, stamping `paidAt` and `paymentConfirmation { reference, providerKey, confirmedBy, confirmedAt }` | `order.payment-confirmed` |
| expiry            | an order-service sweep, every `order / paymentExpirySweepMs`             | `awaiting-payment → cancelled` where `paymentDueAt < now`, cause `payment-expired`                                          | `order.cancelled`         |
| buyer withdraws   | the buyer's capability (§6), on the existing `buyer-cancellation` route  | `awaiting-payment → cancelled`, cause `buyer`                                                                               | `order.cancelled`         |

transaction-service subscribes to `order.*` as one `work` queue with `natural`
dedupe, for the reason its `shipping-order.*` subscription gives, and acts on
`order.payment-confirmed` and `order.cancelled`. Each signals the wait
correlated `payment:<groupId>:<vendorId>` — the order's own id is minted by a
step, so the slip cannot name it, while its group (the flow's id) and its
vendor (the segment's) are known when it is composed. An event for an order
not paid by link is let go, and that covers every other cancellation. `order.payment-confirmed` exists
because a subscriber exists ([ADR 0068](0068-one-outbox-ordered-per-aggregate.md)).

The confirmation verb lives on the **order**, not in payment-service, for two
reasons:

- The race is about the order's state.
- A vendor's session can be scoped on an order and cannot be scoped on a
  `Payment`, which carries no vendor to key a predicate on (ADR 0054's
  residual).

payment-service still writes every `Payment`, behind a crossing token, as the
step after the wait. A `payment.captured` that arrives at an order the verb
already moved to `paid` is left alone by the existing conditional write.

The seller's verb answers `200` with the order, `paid`: the decision is made
at that write, and it starts no flow — the checkout already waiting on it
carries on by the event (unlike `dispatch`, which starts one). A confirmation
that lost to an expiry is refused `409 orderNotAwaitingPayment`. Its copy tells the seller the order expired and
that any money taken goes back through their acquirer. The platform never held
it.

### 5. Settlement: the seller holds the money

A `link` payment reaches the seller's own acquirer account, so it settles as
`cod` does ([ADR 0069](0069-a-checkout-group-of-per-vendor-orders.md)): written
`collectedBy: 'vendor'`, and the payout debits only the platform's cut. An
order whose payment window expired voids its join, as an uncollected `cod`
order does. Both rules are keyed on "collected by the vendor", a property of
the tender, and not on the literal `cod`.

### 6. Who may attach a receipt, and with what credential

A **payment receipt** is evidence: a screenshot or PDF the buyer received from
the acquirer or the bank. It is attached to one vendor order while that order
is `awaiting-payment`, and at most `order / evidenceMaxCount` (3) per order.

| Who                         | Route                                                                              | Credential                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| the buyer                   | `POST /api/product-order/:id/buyer-payment-evidence`                               | the receipt capability in `x-cancel-nonce` and **no session**, matched by digest against the group, before `receiptEndsAt` |
| the vendor                  | `POST /api/product-order/:id/payment-evidence`, the verb `attach-payment-evidence` | a session holding `order-management:product-order:attach-payment-evidence`, through the vendor narrowing                   |
| the buyer, to read          | `GET /api/product-order/:id/buyer-payment-evidence/:evidenceId`                    | the receipt capability, as above                                                                                           |
| vendor or operator, to read | `GET /api/product-order/:id/payment-evidence/:evidenceId`                          | a session and `order-management:product-order:read`, narrowed as every order read is                                       |

- **The capability is the one the buyer already holds**
  ([ADR 0058](0058-the-order-after-payment.md) §5, re-keyable by ADR 0076 §6).
  It is valid for the receipt's **read** lifetime, `receiptEndsAt`, not the
  30-minute cancel window. Two days of waiting do not fit in 30 minutes.
- **A number never authorizes**, as ADR 0076 §5 has it. No route takes an
  order number, and the "find my order" path only re-sends the capability to
  the email on file.
- **Each route accepts exactly one credential** (ADR 0023, ADR 0058 §4).
- **Attach races cancel at the store.** The evidence entry is appended with a
  conditional update on `status: 'awaiting-payment'`. The bytes are written
  first under a fresh key. If the conditional update refuses, the object is
  deleted in the same request, and a sweep removes any object with no record
  after a day.

The record of an attachment is a composition on `ProductOrder`:
`paymentEvidence[]`, each `{ id, objectKey, contentType, byteSize, sha256,
attachedBy: 'buyer' | 'vendor', attachedAt, redactedAt? }`. None of it is
personal. It travels on no event: ADR 0078 §2 builds `order.*` member by
member, and this member is not picked.

### 7. Limits on the file

- **Type:** JPEG, PNG, WebP or PDF, decided by **sniffing the bytes** in the
  domain (a pure function, covered to 100%). The declared `Content-Type` and
  the extension are ignored. SVG and HTML are refused because a browser can
  execute them.
- **Size:** at most `order / evidenceMaxBytes`, 5 MB. It is enforced by the
  service and, before it, by the storefront's own limit, raised from Next's
  1 MB server-action default to the same figure plus framing.
- **Serving:** only through order-service, with the sniffed type,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`,
  `Cache-Control: private, no-store`, and `Content-Disposition: attachment` for
  PDF. No public URL and no signed URL: every read passes the credential check
  above.
- **No re-encoding.** A phone photo may carry its location in its metadata.
  It is not stripped in the MVP: the file is served only to §6's credentials
  and deleted on §9's schedule. That is recorded as a residual, and the
  alternative, an image library in the upload path, is left for when product
  images use the same port.
- **No rate limit,** as in the rest of the fleet (ADR 0058). The count cap and
  the size cap bound what one valid capability can do to its own order.

### 8. Where the file lives: an object-store port in r10c

Q17 is decided: r10c gets an object-store port, a lab adapter and a bucket
adapter.

- **The port** is `ObjectStoreTag`: `put(key, bytes, contentType)`, `get`,
  `delete` and `list(prefix, olderThan)`. It lives in a new `business:policy`
  package, `@r10c/business-ts-object-storage`, because product images may use
  it later and two domains may not import each other. Its contract suite
  ships in the package's testing entry
  ([ADR 0063](0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
- **A store, declared:** `payment-evidence`. It is platform plane, single,
  owned by the `order` slice, with `hosts: []` because it holds bytes, not
  entities, and `truth: system-of-record`. The metadata stays in `order`.
  A store never spans engines, and an object store is a different engine from
  Mongo ([ADR 0020](0020-stores-and-slices.md)).
- **Cells:** `packages/implementation/payment-evidence/fs` for the lab writes
  to a directory named by a config row. `dev:reset` empties it, because data
  is recreated on demand. The bucket cell is written in MVP-5 (5.8) and
  created by nobody until MVP-7: nothing runs on GCP before then. Each cell
  carries one new `tech:` value, and `@r10c/conventions` gains its
  `bannedExternalImports` rule.
- **Nothing in the bytes enters a flow.** The journal and flow-status see
  object keys at most, so the journal's 30-day purge never has to find a
  receipt.

### 9. Deleted with the buyer's personal data

A receipt shows a name, often an account fragment, and sometimes a photo's
location. It is personal data, and it leaves with the rest
([ADR 0076](0076-delivery-destination-buyer-contact-and-the-way-back.md) §4,
#581):

- **The trigger is the group sweep's.** Once `receiptEndsAt` has passed and
  every order in the group is `fulfilled` or `cancelled`, the sweep deletes
  every evidence object of those orders. It stamps `redactedAt` on each
  `paymentEvidence` entry and `$unset`s its `objectKey`, in the same pass that
  removes `contact`.
- **What stays** is the `Payment` row with its `providerReference`, which is
  the authorization number, and `paymentConfirmation` on the order. That is
  the record that money moved. It is not personal, and it is what a
  reconciliation reads.

⚠️ **Whether fiscal law wants the image kept longer is open** (open question
4). The rule above is the default the build implements. If Herber's accountant
says proof of payment must outlive the contact, the image moves to the fiscal
retention period ADR 0078 leaves open, and this section is revised. The
deletion date changes, but a deletion date still exists.

### 10. Link providers and couriers are seeded dictionaries, not enums

As Q18 decided, no provider and no courier is a literal in code. Each is a
dictionary row of public facts. Both dictionaries are **open**: a seller may
choose `other` and type a name.

- **A payment-link provider:** `key`, display `name`, and `hosts[]`, the host
  names its links are served from.
- **A courier:** `key`, display `name`, and `trackingUrlTemplate`, an `https`
  URL with one `{guide}` placeholder.
- **Home:** configuration rows, `order-service / paymentLinkProvider / <key>`
  and `fulfilment-service / courier / <key>`, each a JSON value, edited by an
  operator on the existing configuration screens and served from the
  unauthenticated config read like every unflagged row. That is acceptable
  because no member is a secret.
- **The repository seeds no real name.** The seed holds `other` for each
  dictionary, and nothing else. Which providers and couriers exist for r10c is
  our position on whom we work with
  ([ADR 0080](0080-a-capability-register-holds-one-thin-entry-per-use-case.md)
  §8). The names live in Notion and reach an environment as that environment's
  own rows, set outside the repository: through the configuration screens in
  the lab, and from the production configuration source of plan 5.7. The
  three sample stores (plan 4.19) name their courier and provider through the
  same rows, so a `dev:reset` lab shows `other` until someone adds them.
- **No rate, account, contract status or service level** appears in a row.
  Those stay in Notion ([ADR 0025](0025-where-planning-and-business-knowledge-live.md),
  as revised by [ADR 0080](0080-a-capability-register-holds-one-thin-entry-per-use-case.md) §8).
- **Copied, never referenced.** The order stores the provider's key and name
  as they were when the link was set. The shipment stores the courier's key,
  name and the rendered tracking URL as they were at the guide. A dictionary
  edit changes no past order.

**The link.** The verb `set-payment-link`
(`order-management:product-order:set-payment-link`) is legal from
`awaiting-payment` and may be repeated: the last link wins, and `setBy` and
`setAt` are kept. Its body is `{ url, providerKey }`. The URL must be `https:`
and at most 2,048 characters. When the provider declares hosts, the URL's host
must be one of them. When it does not (`other`), the buyer's page shows the
host in full beside the button and says it is the seller's link. The order's
receipt read carries the link to the buyer. It is not personal data, and like
the rest of the order it is not on the bus.

### 11. The guide, and the courier

- **A shipment gains** `courier { key, name }`, `trackingNumber` and
  `trackingUrl`. The guide is recorded by a vendor verb, **`record-guide`**,
  legal from `awaiting-dispatch`. Recording it is not dispatching:
  `dispatch` stays the delivery flow's start and its pivot. Dispatch is
  refused `guideMissing` while no guide is recorded. Bulk dispatch over a
  selection (ADR 0070, #534) therefore keeps working: a vendor records each
  parcel's guide, then dispatches the morning's parcels at once.
- **The buyer reads the guide from the order.** The buyer reads order-service
  and can never read a vendor's `fulfilment_<id>` database. So
  `fulfilment.dispatch@3` provides `{ courier, trackingNumber, trackingUrl }`,
  and `order.mark-dispatched@3` consumes it onto the order.
- **The courier port** (plan 4.12) gets a simulated adapter that answers the
  delivery flow's wait through the same `record-delivery` move a vendor makes.
  The person's report stays the real path, and the simulator is the fourth
  thing cut if MVP-4 runs late.

## Consequences

- **Checkout gains its first wait.** The flow catalog's recipe and the CI that
  enumerates every composition
  ([ADR 0065](0065-use-case-resolution-and-the-routing-slip.md)) gain a
  branch, and its snapshot changes.
- **`ProductOrder` gains a status, three members and three verbs:**
  `awaiting-payment`; `paymentDueAt`, `paymentLink`, `paymentConfirmation`
  and `paymentEvidence[]`; `set-payment-link`, `confirm-payment` and
  `attach-payment-evidence`. Each verb is a `@useCase()` with its permission
  in `ROLE_PERMISSIONS`, granted to the vendor's `admin`. `confirm-payment` is
  also granted to `user`, as `sell` is, because confirming at the counter is
  staff work.
- **entifix must change first, under MVP-4.** `defineEndpoint` gains a
  binary request body (raw bytes with their declared type, or multipart) that
  the slice shell serves through `HttpApi`. 0.22.4 has none, and base64 in JSON
  is rejected for costing a third more bytes. It is an entifix issue in the
  MVP-4 milestone, released before plan 4.9 and adopted by it
  ([ADR 0059](0059-entifix-leaves-the-repo.md)).
- **The fleet stores bytes for the first time.** That adds one store, one
  port, two cells and one `tech:` value, and a first anonymous upload path,
  bounded by a capability, a count and a size.
- **A 48-hour hold is a promise.** A storefront availability badge will show
  less stock while link baskets wait. It is a hint, as it always was
  ([ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)).
- **Live proof required (plan 4.21):** a parallel burst of confirm against
  expire on one order leaves one winner, with one `Payment` or one release and
  never both. A burst of attach against cancel leaves no orphan object after
  the sweep. A sequential run proves neither (ADR 0058 §3).
- **Revises in place:**
  - [ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md):
    a payment the seller confirms is recorded by a retriable step after the
    commit point, not a pivot; `paid` can be written by the seller's verb
    before `payment.captured` arrives; `PaymentMethods` gains `link`.
  - [ADR 0058](0058-the-order-after-payment.md) §2 and §5: an
    `awaiting-payment` order is cancelled by one conditional write, with no
    refund and no cancellation flow; the buyer's capability authorizes
    attaching evidence, for the receipt's read lifetime.
  - [ADR 0070](0070-fulfilment-and-cash-on-delivery.md): `link` commits like
    `cod`; checkout gains a wait; the dials table gains the payment window and
    "courier: manual" becomes a dictionary and a guide; dispatch requires a
    recorded guide.
  - [ADR 0076](0076-delivery-destination-buyer-contact-and-the-way-back.md)
    (Proposed): payment evidence is personal data deleted by §4's sweep; the
    receipt capability authorizes one write; the review offers `link`.
  - [ADR 0010](0010-stock-ledger-reservations-and-concurrency.md): a hold's
    expiry may be stated per hold, bounded by stock-service.
  - [ADR 0069](0069-a-checkout-group-of-per-vendor-orders.md): money the
    vendor collected, by courier or by link, settles `collectedBy: 'vendor'`.
  - [ADR 0073](0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md):
    a storefront checkout settles on `flow.waiting`.
- It supersedes nothing.

## Decided with Herber, 2026-11-17

The draft raised sixteen conflicts. Herber accepted every recommendation, and
each one is folded into the text above:

1. The seller's confirmation is a verb on the order. payment-service records
   the `Payment` as the next flow step, and plan 4.10's scope becomes
   `shells-effect-order, shells-effect-payment` (§4).
2. A `link` segment commits with `flow.commit@1`, then waits.
   `WaitBeforeCommit` is not relaxed (§2).
3. A hold's expiry is stated per hold through `stock.reserve@3`, bounded by
   `maxHoldSeconds`, and outlives the wait. The wait strands on timeout (§3).
4. The storefront settles a checkout on `flow.waiting` (§2).
5. Settlement treats link payments as collected by the vendor, and voids an
   expired link order's join (§5).
6. Plan 4.9 depends on M19's `receiptEndsAt`. The cancel window is not
   lengthened (§6).
7. Provider and courier dictionaries are configuration rows (§10).
8. ADR 0080 §8 states what the repository may hold about providers and
   couriers (§10).
9. No real provider or courier name is seeded. The names stay in Notion (§10).
10. Receipt deletion against fiscal retention stays open, for Herber's
    accountant (§9, open question 4).
11. entifix gains a binary or multipart request body, as an entifix item
    under MVP-4 (Consequences).
12. The lab adapter writes to the filesystem. No MinIO and no new health-ladder
    rung (§8).
13. An `awaiting-payment` order is withdrawn by the expiry's own conditional
    write, by the buyer or the vendor, with no cancellation flow (§4).
14. A seller accepts payment links through an `Organization` member announced
    into the published vendor, until tenant configuration lands (§1).
15. `record-guide` is its own verb before `dispatch`, so bulk dispatch stands
    (§11).
16. Phone photos are not re-encoded in the MVP. Their location metadata is a
    residual, bounded by §6's credentials and §9's deletion (§7).

## Open questions

1. Whether a seller may record a confirmation with no receipt attached. The
   draft says yes: the authorization number is the evidence.
2. HEIC uploads from iPhones. Safari normally converts on upload, and if not,
   the type is refused. The live pass must check.
3. Reminders before expiry, by email (#587's sender) or WhatsApp link (4.14).
4. **How long a payment receipt image must be kept**, for Herber's accountant
   beside Q13. Until answered, §9's deletion with the contact is what is
   built.

## Trigger

ADR 0076's receipt lifetime is built (M19), and plan 4.7 starts. The record
moves to Accepted when the live parallel bursts in Consequences pass in the
three verticals (plan 4.21).
