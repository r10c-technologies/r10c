# 53. Scoping a platform-plane read to its caller, and a receipt that needs no session

- Status: Accepted
- Date: 2026-09-09
- Area: auth
- Read when: a read has to be narrowed to whoever is asking, or an anonymous buyer has to be shown something that is theirs — the scope is conjoined onto the load request and never expressed as a query, and a receipt is carried rather than read back

## Context

[ADR 0052](0052-the-checkout-saga.md) built checkout and left two holes recorded
on the source rather than closed. Both are the same question asked from opposite
ends — *whose order is this?* — and the fleet could answer it in neither
direction.

**The read side.** `GET /api/product-order` guarded a permission and stopped:

> ⚠️ **Recorded residual: the list is not scoped to the caller.** `guarded`
> checks the permission and stops there, so any principal holding
> `order-management:product-order:read` sees every order.

That was correct for the two surfaces #231 built — an operator's view and a
vendor's back-office list, both of which are *meant* to see more than one
buyer's orders. It stops being correct the moment a buyer holds a session.

⚠️ **The `order` store is platform plane**, which is what makes this different
from every scoped read already in the fleet. stock-service isolates by resolving
a `stock_<organizationId>` handle inside the request, so no query there can leak
by omission — the isolation is a property of the connection. Here one database
holds every buyer's receipts, and a predicate is the whole boundary. That is
precisely the discriminator-column shape `docs/_shared/planes.md` warns about,
and it is forced rather than chosen: a basket can span vendors, so one order
cannot live in any one vendor's database
([ADR 0022](0022-v1-marketplace-module-boundaries.md)).

**The write side's aftermath.** A successful checkout redirected to
`/{locale}/cart?checkout=placed` — a success banner above an emptied cart, which
reads more like a cancellation than a purchase. And the storefront cannot simply
fetch the order it just placed: it has **no auth gate at all**, which is why
checkout takes a crossing token rather than a session, while order-service's
reads take a session and no token.

### Three facts that shaped every decision below

**The token knew the account, not the party.** `ProductOrder.buyerId` holds an
`Individual` id; the access token carried `userId`. The user → party hop exists
in exactly one store — auth-service's — so no other service can make it.

**`buyerId` is `filterable`.** A client can already send
`rsql=buyerId==<someone>`, and a client that can send that can send somebody
else's id. Scoping through the query string was therefore never available, and
making the member unqueryable would break the back office's own record search,
which uses it as the only member that can name an order to a human.

**An order id is unguessable but still a capability.** `randomUUID` at
`place-order.ts` means nobody enumerates receipts — but a URL is copied, logged,
shared and put in a browser history, and a page that renders whatever order its
path names is a page that hands a receipt to anybody holding the link.

## Decision

### The token carries `partyId`, beside `partyRole`

One more claim, resolved by the lookup `SessionScopeResolver` already performs:
it reads the `Individual` to decide `partyRole`, so the party's own id is on the
document in hand. It rides the token in every respect
[ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md) decided for
`partyRole` — resolved once at sign-in, re-signed unchanged on refresh, context
and never a grant — and travels on the session record so the refresh path never
reads the party store.

**Absent means no party, never any party.** An account with no `Individual`
resolves to no claim, and every consumer must narrow to nothing rather than
widen; the same direction `entitlements` picks for the same reason.

This is also the record that makes ADR 0015's *"`partyRole` is carried, not yet
consumed"* consequence obsolete. It has been corrected in place there rather than
restated here.

### The scope is conjoined onto the load request, and is never a query

The route builds a predicate from the verified principal and **pushes it onto**
`EntityLoadRequest.filtering`. That is safe for a structural reason rather than a
careful one: `parseLoadRequestParams` collapses the caller's entire expression
into a single element of that array, and the Mongo translator `$and`s every
top-level element. An added element can only narrow, and no `or` a caller writes
can escape it.

⚠️ **Not by concatenating rsql**, which has none of that property and which this
codebase does nowhere. And not by trusting a filter the client sent: the scope is
added regardless of what arrived, so `rsql=buyerId==<another party>` answers an
empty page rather than that party's orders.

The vendor predicate names `items.vendorId`, a path into a `composition`. The
member allowlist runs at parse time and nothing re-checks downstream, which is
exactly what lets *server* code reach an embedded path that a query string
cannot — `items` stays unqueryable to every client.

### Three predicates, chosen by `partyRole`, gated by the permission

| Principal              | Reads                                       |
| ---------------------- | ------------------------------------------- |
| `partyRole: operator`  | every order                                 |
| `partyRole: vendor`    | orders with a line naming their organization |
| anything else          | orders whose `buyerId` is their party        |
| no organization / no party | nothing — an empty page, not a `403`    |

⚠️ **`partyRole` selects a predicate; it grants nothing.** The route requires
`order-management:product-order:read` first, so a party role on its own opens no
order, and the claim arrives on the same verified token `roles` does.

**The operator's wider read is not a permission of its own, and that is a
constraint rather than a preference.** A permission's action segment is the CRUD
triple or a `@useCase()` verb ([ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)),
and `@r10c/slices` fails the build on a grant naming a verb nothing declares — so
`product-order:read-any` would have to be backed by a use case, and a use case is
a verb on a record rather than a way of reading a list. Recorded so the next
person asks the question once. If reading unscoped ever needs to be revoked from
one operator and not another, that is the day this becomes a declared verb.

**A caller who owns nothing gets an empty page rather than a refusal.** Holding
the grant and owning no records are different facts, and only the first is about
authorization.

### The by-id read is scoped too, and answers `404`

`id` is the one member that is neither sortable nor filterable, so a by-id read
cannot be expressed as a filtered load: the record is fetched and then tested
against the same scope. A record outside it answers the `404` an absent one
answers — a `403` would confirm the order exists to somebody who may not see it.

### Both new predicates get an index, because the scope is the query

The `product-order` collection had **no index at all**. Both predicates are now
indexed with `placedAt` descending as the second key, since an order list is read
newest-first and an index that covers the filter but not the sort leaves the
matched set sorted in memory. Ensured at boot, which this store can do and a
tenant store cannot.

### The receipt is carried in a cookie, not read back

A successful checkout writes an `httpOnly` `r10c_receipt` cookie from the order
the saga already returned, and redirects to `/{locale}/order/confirmation`.

⚠️ **The address identifies no order.** It is the same path for every visitor, so
there is no capability to leak, nothing to guess and nothing to share by
accident. The three alternatives were each worse:

- **Read the order back with the id in the URL** — the capability problem above,
  and it needs a public read route on a store holding every buyer's receipts.
- **A receipt token on the order** — the same public route, plus its own rate
  limiting, plus a second identity mechanism for the storefront to maintain.
- **Read it server-side with a crossing token** — a second accepted credential on
  a read route, which is what [ADR 0023](0023-service-to-service-tenant-crossing.md)
  says makes the weaker one the security level.

The cookie is parsed as untrusted input: it is `httpOnly` so no page can write
it, but a browser's owner can, and the worst a forged one achieves is showing its
author a receipt they invented.

**A cookie is 4KB and a basket has no upper bound**, so past a line cap the
receipt keeps the order id, the totals and the line count and drops the lines,
and the page says how many there were. A truncated list rendered as the whole
order would be a receipt that lies.

⚠️ **The receipt totals per currency, not once.** Found on the live fleet, whose
seed prices in two: a marketplace's vendors price independently, one basket held
a `GTQ` line and a `USD` line, and a single sum labelled with whichever currency
came first states a price nobody was charged. There is no exchange rate anywhere
in this system, and inventing one on a receipt would be worse than showing two
figures.

⚠️ **A `201` whose body cannot be read does not fail the checkout.** The order is
written by then; the buyer lands on the cart's success banner, which is where
this stood before there was a confirmation page.

## Consequences

- **"My orders" on the storefront is still not possible, and this record does not
  make it so.** It needs a buyer identity the storefront has not got, and
  `buyerId` is optional precisely so a counter walk-in is not made to invent one
  ([ADR 0024](0024-selling-through-a-vendors-own-channel.md)). What exists now is
  the authenticated half — a signed-in buyer's list is correctly scoped — and an
  anonymous receipt that does not pretend to be a history.
- **The receipt is per-browser and expires.** It is not reachable from another
  device, and a lapsed one renders an expired state rather than an error. Stated
  on screen rather than discovered.
- **A session minted before this change carries no `partyId`**, so it scopes to
  nothing rather than to everything. Sign in again; nothing runs in production
  and no dual-read window exists to bridge.
- **The list response echoes the injected predicate**, because the envelope
  echoes the request. It discloses the caller's own scope to the caller.
- **The mock e2e profile learned dotted paths.** The fake Mongo driver matched
  only top-level fields, so `items.vendorId` would have answered empty there
  while working against a real server — a spec passing while asserting the
  opposite of its claim. It now walks a path element-wise, and excludes a
  document when *any* value at the path matches a negation, which is the
  server's own asymmetry.
