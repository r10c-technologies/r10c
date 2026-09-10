# 56. The counter sale is the checkout saga, and the till holds no secret

- Status: Accepted
- Date: 2026-09-10
- Area: business
- Read when: a vendor sells somewhere other than the storefront, or a browser surface needs to start a flow that writes another slice's store — the sale is the same saga with a channel on it, and the decision is made where a session can actually be verified

## Context

[ADR 0024](0024-selling-through-a-vendors-own-channel.md) decided the model and
deliberately built none of it: a `SalesChannel` entity, a `sales` store at
`status: 'planned'`, `ProductOrder.channel`, `Payment.channelId`, an optional
`buyerId`, and per-channel commission on the `Agreement`. Its own follow-up list
named what was missing — the service, the shell, the host wiring — and said
nothing about how a screen in the back office would actually cause a sale.

That gap is where the real decisions are, because a counter sale crosses three
slices this one does not own. Stock is held in the vendor's tenant database,
the order is written in the platform plane, and the capture is the pivot that
cannot be undone. Every one of those is a step the checkout saga already
dispatches ([ADR 0052](0052-the-checkout-saga.md)) behind a crossing token that
can name any organization ([ADR 0023](0023-service-to-service-tenant-crossing.md)).

Two facts about the fleet shaped what follows.

**No role holds `order-management:product-order:write`, and the grant table says
none is coming.** An order is written by the saga, because holding a vendor's
stock is a crossing rather than an act a session performs. So "the seller may
write an order" was never available as an answer.

**A Next server action can carry a session cookie and cannot verify one.** The
only session readers in `shells-next-common` are `sessionToken` and
`bearerHeader`, which forward a token and check nothing, plus the nav's
`unverifiedClaims`, which reads the cookie *without checking its signature* and
is documented as never a decision.

## Decision

### 1. A counter sale is `POST /api/saga/checkout` with a channel on its order

No new flow, no new definition, no second path into stock or settlement. The
till's sale runs the same four steps — reserve, write the order, capture,
convert the hold — and differs only in what rides on two of the inputs: a
`RelatedChannel` copy on the order, a `channelId` and a `paymentMethod` on the
payment, and no `buyerId` at all.

That follows from ADR 0024 rather than being a new decision, and it is restated
here because the implementation is where it would have been quietly abandoned. A
second definition would have been easy to justify per-step and would have split a
vendor's takings, their returns and their buyer's history in two.

### 2. sales-service starts the flow; the till holds no crossing token

`POST /api/counter-sale` is served by sales-service, takes a **session and no
token**, and does four things in an order that is what makes the fourth safe:

1. `requireOrganization(SELL_AT_CHANNEL)` — a verified principal, an active
   organization, and the verb below.
2. The channel is loaded from the **caller's own** tenant handle, so another
   vendor's channel id resolves to nothing rather than to their record, and the
   domain refuses a retired one.
3. Every line is re-priced from the published projection and refused unless its
   `vendorId` is the caller's organization.
4. Only then is the coordinator's crossing token presented.

⚠️ **The storefront legitimately does the opposite, and the asymmetry is the
point.** `checkout-action.ts` reads the crossing secret in a `'use server'`
module and posts to the coordinator itself, because the storefront has no session
to check — what a crossing token proves there is that the fleet is asking. The
back office *has* a session, so copying that arrangement would mean holding a
secret in a process that cannot check who is exercising it, one guard-swap away
from being the security level. Two holders of the coordinator's inbound token,
each for a reason the other does not have.

### 3. The price comes from the published projection, never from the request

The till sends offering ids and quantities. sales-service reads
`GET /api/published-offering` and takes `amount`, `currency` and `vendorId` from
there.

A browser that could send an amount could sell a vendor's goods for nothing, and
this route presents a token that can name any organization — so the one input
that must not be caller-controlled is the money. Reading the vendor's *tenant*
catalog instead would have allowed selling an unpublished offering, at the cost
of a price-selection rule nobody has written and a counter that can charge a
price no buyer was ever shown. An unpublished offering is not sellable at the
counter, stated here so it is not rediscovered as a bug.

### 4. Selling is a verb on the channel, granted to `admin` **and** `user`

`sales-management:sales-channel:sell`, declared by `SellAtChannelUC` and derived
by `permissionForUseCase` so the string `sell` is written once.

It sits on the channel because that is the record the act is performed through,
and it is granted to `user` because staff at a till are `user` — the whole reason
a verb was needed is that "may see which counters exist" and "may take money
through one" are different authorities. The use-case's `run` carries the one rule
this domain owns: a retired channel takes no sale. A channel is retired by state
rather than deletion, so it stays readable and stays pickable by anything that
does not check.

### 5. `SalesChannelTypes` moves to a `business:policy` package

ADR 0024 recorded the duplication between `sales-management` and
`settlement-management` as deliberate, with a shared vocabulary package as the
fix "if it ever bites". It bites here: a channel type now travels from a vendor's
channel record, through the saga, onto an order and into a commission — three
domains, none of which may import another.

`@r10c/business-ts-sales-vocabulary` holds the closed set;
`CommissionableChannelTypes` is deleted rather than aliased, and
`RelatedChannel.type` stops being a bare `string`. The spec that pinned the
duplicate goes with the duplicate.

## Consequences

- **This record amends [ADR 0024](0024-selling-through-a-vendors-own-channel.md)
  in place**, and supersedes nothing. Its "not doing either now" on the
  duplicated literals is struck; its "deployments unchanged at six, because the
  `sales` slice is planned" no longer holds, since this promotes the slice and
  binds `:3109`. The reasoning is unchanged — only inventories moved, which is a
  correction rather than a reversal.
- **The `sales` slice writes one store and calls two others.** Its
  `dependantAPIs` gain `POST /api/saga/:definition` and
  `GET /api/published-offering`. "A slice writes only the Stores it owns" holds
  unamended: the till's write is somebody else's, dispatched.
- **No new tenant crossing**, which is what ADR 0024 promised and what the
  arrangement above preserves. sales-service is not a participant; it starts a
  flow, and the crossings inside it are the ones ADR 0023 already named.
- **A second holder of the coordinator's inbound token.** It is the same
  concentration ADR 0023 recorded a residual for, one process wider. The named
  upgrade path is unchanged: an RS256 service token minted by auth-service, giving
  the call an identity rather than a password.
- **The till is an Asistente, and the channels are Definiciones.** By ADR 0033's
  own test: a vendor names their counter and orders then reference it, while
  selling is guided, multi-step and ends. The till owns no entity, so it is
  addressed `wizard:counter-sale` and is not a surface.
- **Enum members are checked on the channel's save route.** `enumValues` is
  metadata a form renders from, not a server-side validator, and every other
  service in the fleet accepts a member outside its declared set. A channel
  *type* is priced against, so one nobody has a rate for falls through to the
  agreement's default — a wrong invoice rather than an error.
- **What is still absent**: settlement reading `commissionFor` (its slice is
  still `planned`), a till that reconciles cash, and any way to attach a party to
  a past counter sale. The first is M6; the second is ADR 0024's deferred
  `PointOfSaleSession`; the third is a backfill rather than a lookup, as that
  record already said.
