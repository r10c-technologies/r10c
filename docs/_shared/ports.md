<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

`-app` frontends are reached on **300N**, `-service` backends bind **310N**,
cross-cutting platform services use **319x**; the domain index `N` is shared per
frontend/backend pair. Infra exposes minikube NodePorts at `30000 +` the
canonical port.

| Domain (`N`)            | `-app` | `-service`          |
| ----------------------- | ------ | ------------------- |
| marketplace (0)         | 3000   | 3100²               |
| marketplace-admin (1)   | 3001⁴  | 3101                |
| auth (2)                | —⁴     | 3102                |
| transaction-manager (3) | —      | 3103³               |
| system-management (4)   | 3004¹  | —                   |
| order (5)               | —      | 3105⁷               |
| payment (6)             | —      | 3106⁸               |
| settlement (7)          | —      | 3107⁵               |
| stock (8)               | —      | 3108⁶               |
| sales (9)               | —      | 3109⁹               |
| fulfilment (10)         | —      | 3110¹⁰              |
| — platform —            |        | config-service 3190 |
| — platform —            |        | realtime 3191¹¹     |

⚠️ **A `300N` is an origin, and the edge owns it — Next listens on `320N`, the
origin + 200** ([ADR 0072](../adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
A server-sent stream cannot cross a Next route handler, so the browser no longer
reaches Next directly: a local Envoy (`@r10c/edge:serve`, a container pinned by
digest) listens on `3000` and `3001`, routes `/api/realtime/*` on both to `3191`
and everything else to `3200` / `3201`. Zitadel's redirects, config-service's
origin rows and the e2e base URLs keep naming `3000`/`3001`, unchanged. Each
app's `free-ports` frees its `320N` only, so restarting an app never kills the
edge; `pnpm run dev-ports:free` removes the edge's container too. The route
table is `tools/edge/src/routes.ts`, rendered into `tools/edge/envoy.yaml` and
the cluster's Envoy Gateway manifests in `infra/cluster/edge/`, and
`@r10c/docs-check` fails a listener that is not a `300N` origin, an upstream that
is not the origin + 200 or is missing from `ALL_PORTS`, an origin that does not
route the realtime prefix, a stream route with a timeout, an idle timeout under
twice the push heartbeat, or an access log that writes a query string.

A `-service`'s `dev` also opens the Node inspector at its service port **+ 6000**
(`3100` → `9100`, `3190` → `9190`), set as the `@nx/js:node` `port` option. The
executor's default is `9229` for every process, so a fleet of three services left
only the first with a debugger and the other two logging `address already in use`.
`@r10c/docs-check` fails a service that drops the option.

A service that runs the durable flow engine also opens one **runner port per
replica**, at its service port **+ 31000 + 1000 × the replica**
([ADR 0066](../adr/0066-flows-run-on-a-durable-workflow-engine.md)):
transaction-service's replica 0, the process that serves HTTP, listens on
`34103`, and its runner-only replica 1 (`dev-runner`, `WORKFLOW_REPLICA=1`) on
`35103`. The offset clears every service port, inspector and NodePort above, and
`@r10c/docs-check` fails a runner port that leaves the formula, `RUNNER_PORTS` in
`tools/free-ports.sh`, or this table.

**The index is per host, not per pair.** ADR 0008 allocated `300N`/`310N` to
frontend/backend _pairs_, which stopped describing the fleet the moment one host
began serving two domains. A domain still owns its `-service` index; what it no
longer implies is a frontend of its own.

¹ Reserved, not built. The system-management screens live in the `scope:shared`
shell `@r10c/shells-next-system-management` and are mounted by
back-office-app today; the dedicated bastion app takes this index when it
lands, and needs no `-service` of its own (config-service is its backend).

² **marketplace-service, back on `:3100`, and it has two clients.** It was deleted by
[ADR 0021](../adr/0021-consolidating-the-fleet-into-five-deployments.md) as a
36-line health-check shell with no router, no store and no domain — not a Slice,
and a placeholder deployment is a thing to keep booting, probing and reasoning
about for no return.

[ADR 0022](../adr/0022-v1-marketplace-module-boundaries.md) rebuilds it because it
now owns **two** stores: `catalog-reference` (the operator-authored brand,
category and dictionary vocabulary, platform plane, system-of-record) and
`published-catalog` (`projection-of:catalog`). It is the storefront's read host
and the only writer of the projection, consuming `catalog.published` off the bus —
which is what keeps a public read path from ever opening a tenant connection.

The storefront is not its only client. **back-office-app reads the same
vocabulary from here**, through a second same-origin proxy at `/api/marketplace`
(`marketplace-service-domain` in config-service), because the brands and
categories an operator authors are the ones a vendor's offering is classified
in. So `back-office-app:dev` starts marketplace-service alongside
marketplace-admin-service, and the back office composes catalog URLs from **two**
domain keys: `ProductSpecification` from `:3101`, `ProductBrand` and
`ProductCategory` from here.

And the dependency runs the other way too: **`marketplace-app:dev` starts
marketplace-admin-service** alongside marketplace-service. The storefront reads
only this service — but nothing here writes `published-catalog`, it only
projects into it, and what fills it on a fresh lab is ADR 0050's rebuild walk,
which runs in marketplace-admin-service. A storefront fleet without that service
comes up healthy, green on every probe, serving an empty catalog.

**It starts auth-service too**, for the same reason one store over. The
`published-vendor` projection holds each seller's display name, and what fills
it is auth-service announcing its organizations: the seed's write, and a
rebuild walk on every boot that re-states each one at its own stamp
([ADR 0061](../adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
Without auth-service a storefront renders every product with no seller line.

The difference from the version that was deleted is exactly the thing ADR 0020
made sayable: a deployment earns its existence by owning a store.

³ **transaction-service, bound — and this index is the one that proves the
claim it was reserved on.**

The `transaction` slice was **co-deployed** into
marketplace-admin-service, and the note here said that ownership had not moved,
only the process, so splitting it back out would mean pointing its declaration
in `tools/slices/` at a new app rather than untangling a database. That is
exactly what happened on 2026-09-08 (#229), when checkout's participants turned
out to be stock-service (`:3108`) and order-service (`:3105`) — ADR 0039's stated
trigger — and no data moved at all.

It is the **flow coordinator** ([ADR 0066](../adr/0066-flows-run-on-a-durable-workflow-engine.md)).
`POST /api/flow/checkout`, `POST /api/flow/cancellation` and `POST
/api/flow/delivery` compose a slip from what they verified and hand it to the
durable flow engine over the Postgres `workflow` store, answering `202
flowAccepted` with the flow's status and stream links; the outcome reaches a
browser through the realtime slice. The routes are `/api/flow/<recipe>` rather
than business verbs because this slice declares **no domain**, and a verb here
would put a domain name in a permission namespace nothing is provisioned for.
Checkout and cancellation run on `order-management:product-order:write`, and a
delivery on `shipping-order-management:shipping-order:dispatch-step` — the
crossing its own pivot takes — so none adds an entry to
`SERVICE_CROSSING_PERMISSIONS`.

⚠️ **A delivery waits days, and branches on what it is told.** After the
dispatch pivot it parks on the courier's report — `delivered`, `refused`, or
nothing inside the `delivery.awaitDeliveryTimeout` window, handled as a
refusal — and a refused parcel parks again on its return, inside
`delivery.awaitReturnTimeout`; both are config rows the coordinator states into
every delivery. A return that never comes **strands** the flow (`flow.stranded`)
for a person rather than retrying it. The waits are answered by this slice's one
subscription, `shipping-order.*` as a `work` queue: each report signals the
wait parked on that shipment, a report arriving before its flow reached the wait
is retried by redelivery, and one the parked wait is not answered with — or
already took — is let go, which is the dedupe ([ADR 0070](../adr/0070-fulfilment-and-cash-on-delivery.md)).

⚠️ **The coordinator verifies, the caller states.** A vendor segment's
entitlements are read from the published vendor projection (`holdsStock`,
`acceptsCod`, announced by auth-service off the organization's entitlement) and
overwrite whatever the start input said; a checkout's group id is the flow's own.
A start's idempotency is the engine's registration of its `Idempotency-Key`, in
the `workflow` store, so the slice owns no Mongo store at all.

The engine runs on two runners, `34103` beside the HTTP process and `35103` as
`dev-runner`, with a breaker and a bulkhead per participant whose dials are
config rows (#462). The saga runner, its `saga` store, its resume sweep and
`GET /api/saga/:id` were deleted when checkout and cancellation moved onto the
engine (#490).

⚠️ **Both app `dev` targets start it, and every participant with it**: the
storefront's checkout and the till's counter sale both start here, so each app's
`dev` also starts stock-, order-, payment- and fulfilment-service — a flow whose
participant nothing started fails at its first step.

It holds a **crossing token per participant**, which is the concentration
ADR 0023 recorded a residual for and ADR 0039 restated: one process that can
name any organization. Separate `is_secret` rows, separate rotations, and the
named upgrade path is unchanged.

⁵ **settlement-service, bound — and the last of the five reserved indices to be
claimed.** It owns the `settlement` store, which is the one commerce store on the
**control** plane. A plane answers _who may read it_, and an `Agreement` —
commission terms between the platform and one vendor — is the platform's own
record about a vendor, the same character as `Entitlement` and nothing like a
public catalog ([ADR 0022](../adr/0022-v1-marketplace-module-boundaries.md) §8).

It serves the vendor's terms and their statement: `GET|POST|PUT /api/agreement`,
and read-only `commission-entry`, `settlement-run` and `vendor-payout`.

⚠️ **Every read is narrowed to the caller.** An operator reads across vendors; a
vendor reads their own agreement, their own ledger lines and their own payouts;
anybody else gets an empty page. That scope is why a read grant exists here at
all — `payment-management:payment:read` was withheld from every role but `admin`
precisely because a `Payment` carries nobody to key a predicate on, and ADR 0054
recorded the residual rather than shipping unscoped. Writing an agreement is
granted to **no** role: an `admin` who could write it could set their own
commission to zero, so it is an operator act reached through `super-admin`'s
wildcard.

⚠️ **It subscribes to four events, in two pairs, and no member of either pair is
sufficient alone.** `payment.captured` says money moved and names the order; it
carries no vendor lines and only a channel _id_, which points into a tenant store
this slice cannot open. `order.placed` carries the vendor-tagged lines and the
channel _type_ copied onto the receipt. So the two are joined on the order id and
whichever completes the pair writes the commission entries
([ADR 0057](../adr/0057-settlement-joins-the-sale-to-its-payment.md)). This is
the consumer ADR 0054 said `order.placed` was being drained for.

⚠️ **The second pair undoes the first, and it is a pair for a different reason.**
`payment.refunded` says money went back, `order.cancelled` says the sale is off,
and neither implies the other — an order cancelled before it was ever paid has
nothing to reverse — so a reversal is written only when both are true. The
amounts are **mirrored from this slice's own ledger**, never re-priced from the
cancelled order: re-reading the agreement at cancellation time would price the
mirror at whatever rate is in force now, and terms re-negotiated since the sale
would leave a pair that does not cancel. The reversing rows carry negative
amounts and no `runId`, so the next sweep picks them up like any unsettled line
and a run may legitimately produce a **negative** `VendorPayout` — a claw-back
against the vendor's next period, allowed rather than clamped
([ADR 0058](../adr/0058-the-order-after-payment.md) §9).

⚠️ **One join per vendor order** ([ADR 0069](../adr/0069-a-checkout-group-of-per-vendor-orders.md)).
A capture contributes each of its allocations to its own order's join, a partial
refund mirrors only its share of the sale, and cash a vendor collected on delivery
is written `collectedBy: 'vendor'` — the payout debits only the cut, since the
vendor already holds the gross. A cash-on-delivery order cancelled before its cash
was collected voids its join: nothing settles and nothing reverses.

⚠️ **Both halves of both pairs land on one join record**, and the second pair's
fold refuses to run until the first has. A reversal cannot precede the sale it
mirrors, and a placement that arrives after its order was already cancelled and
refunded writes the sale and its mirror in a single transaction. A separate
reversal record would have written neither.

⚠️ **A refused capture and a refused refund announce nothing.** A capture
that refused is the checkout flow's pivot refusing, which compensates the flow
and deletes the order — nothing to settle and nothing to un-settle — and an
event no slice subscribes to is not published
([ADR 0068](../adr/0068-one-outbox-ordered-per-aggregate.md)).

It publishes nothing. A completed run was announced on the bus until [ADR 0068](../adr/0068-one-outbox-ordered-per-aggregate.md)
ruled that an event is published only when a slice subscribes to it; a payouts
process is what would, and that is not built.

⚠️ **It holds no crossing token and accepts none.** Every one of its inputs
arrives on the bus, so nothing dispatches into it, and every route it serves is
guarded by a verified session. It is the only slice in the fleet with a store, a bus
connection and no service secret at all.

**`back-office:dev` starts it** and `mp:dev` does not, because it is no
checkout participant and has a back-office surface: a vendor's terms and
their statement are screens, and a proxy pointed at a process nothing started is
a nav item that 502s.

`payment` was on this list until #152 and `sales` until #92, and they are now
footnotes 8 and 9 — the mechanism working three times over: promoting each was a
`deployments` edit and a `FLEET` entry, exactly as the reservation promised. With
this one the reserved list is empty.

`sales` took index 9 rather than the then-free `3103`, which was reserved for
the `transaction` slice splitting back out of marketplace-admin-service — and
now holds it. Reclaiming an index that already means something else is how a
port table stops being readable, and the reservation is what made the split a
`deployments` edit rather than a port negotiation.

⁸ **payment-service, bound.** The second of the five reserved indices to be
claimed. It owns the `payment` store — **platform** plane and single, one named
database beside the order's rather than inside it, so "which slice writes a
payment?" has one answer and a future PSP-facing process (webhooks, retries,
reconciliation, all arriving on someone else's schedule) can be lifted out
without touching orders.

`Payment` sits behind a `PaymentProviderTag` port with a **simulated** adapter.
Real provider integration is out of v1 scope; what matters now is that the port
keeps `authorize` and `capture` separate, because roughly a fifth of Guatemalan
e-commerce is _contra entrega_ — the money reaches a courier's hand days after
the order, which is only sayable if the two are separate calls.

⚠️ **`POST /api/payment` is the checkout flow's pivot**, and the only write in
the fleet that cannot be compensated. It takes a **crossing token and no
session** — the buyer behind a checkout holds no grant over the capture made on
their behalf — while its reads take a session and no token. One route, one
credential, each way. Its crossing permission is therefore an unpaired entry in
`SERVICE_CROSSING_PERMISSIONS`: a refund is a new record with its own money
movement, not the absence of this one
([ADR 0054](../adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
It was the **only** such entry until the refund below became the second.

⚠️ **One capture per checkout group, allocated per vendor order.** `POST
/api/payment` takes the group's total and its `allocations[]`, and writes a
`PaymentAllocation` per order — unique on the order, because an order is paid
for once ([ADR 0069](../adr/0069-a-checkout-group-of-per-vendor-orders.md)).
`payment.captured` carries the allocations, so order-service advances every
order a capture paid for and settlement folds each one.

⚠️ **`POST /api/refund` is the _cancellation_ flow's pivot**, and the second
write here that cannot be compensated. It takes a crossing token and no session
for the same reason the capture does, and it is addressed by **order id** — the
flow holds an order and has never seen a payment — resolving that order's
allocation itself. Without an `amount` it gives back all that is left of the
share; with one, that part of it. A `Refund` is its own record: ADR 0054
protects the capture row as the evidence a customer was charged, so a
`'refunded'` status written over it would erase that evidence by another route
([ADR 0058](../adr/0058-the-order-after-payment.md)). Two guards stop an
over-refund and they answer different questions — `Idempotency-Key` covers a
redelivery of one command, and a guarded `$inc` on the allocation
(`refunded + amount <= captured`), taken **before** the provider is called,
covers any number of commands aimed at one share.

⚠️ **Cash on delivery is two crossing routes** ([ADR 0070](../adr/0070-fulfilment-and-cash-on-delivery.md)).
`POST /api/cod-eligibility` refuses a seller's order over `cod.maxAmount` (GTQ
1,500 per vendor order, seeded) or from a seller the published vendor
projection says does not ship it, and `cod.enabled` switches it off fleet-wide.
`POST /api/collection` records the cash a courier collected as a `cod` payment
for that one order, announced as `payment.captured`. Their permissions,
`collection:write` and `cod-eligibility:read`, are this slice's third and fourth
entries in `SERVICE_CROSSING_PERMISSIONS`, neither paired with a reversal.

⚠️ **`payment-management:refund:write` is therefore a _second_ unpaired crossing
permission, not the pairing the note above says `payment:write` lacks.** Filing
it as one would be backwards: it is a new money movement whose own reversal
question has the same answer, because un-refunding is charging a customer again.

It publishes `payment.captured` and `payment.refunded` from an
outbox in its own store. The capture _decision_ never arrives as a message — the checkout flow
dispatches it — so what the bus carries is the consequence: order-service advances an order
to `paid`, and settlement will fold a commission entry in M6.

**Both app `dev` targets start it**, as they start every checkout participant:
a fleet without it is a checkout whose pivot fails against an address nothing
is listening on.

⁷ **order-service, bound.** It owns the `order` store — **platform** plane and
single, one named database, which is the opposite of stock's per-request tenant
handle beside it. That is forced rather than chosen: a basket can span several
vendors, so its receipt cannot live in any one of their tenant databases. A
checkout writes one `CheckoutGroup` — the buyer's receipt, opened under the
flow's own id — and one `ProductOrder` per vendor in it, so each vendor reads,
ships, cancels and is refunded for their own order alone
([ADR 0069](../adr/0069-a-checkout-group-of-per-vendor-orders.md)). A vendor
never reads a group: it would show them the other sellers in the basket.

⚠️ **It reserves nothing itself.** ADR 0023's crossing into stock is dispatched
by transaction-service, which holds both halves of the checkout flow; this
service is a _participant_. The checkout writes accept a **crossing token and no
session** — the buyer behind a checkout holds no grant over the receipt written
on their behalf — while its reads accept a session and no token. One route, one
credential, each way ([ADR 0023](../adr/0023-service-to-service-tenant-crossing.md)).

`DELETE /api/product-order/:id` is a **compensation**, not a customer-facing
cancel: it undoes a step that should not have happened. A cancellation is a
business event with its own record and its own money consequences, and it is
the derived verb `POST /api/product-order/:id/cancel`
([ADR 0071](../adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).

⚠️ **Three credentials on one surface, and each route still takes exactly one.**
`cancel` is session-guarded by the permission its own `@useCase()` descriptor
derives — there is still no `product-order:write` for any role, and it is a verb
rather than a save. `buyer-cancellation` and `GET
/api/checkout-group/:id/buyer-receipt` take the nonce from a storefront receipt
and **no session at all**: the group stores that nonce's SHA-256 digest, so the
record is the authority and the credential is inert wherever else it travels. The
flows' own steps — the group's opening, an order's write, its `cancelling` claim
and its `confirmed`, `dispatched` and `closed` moves — take a crossing token
([ADR 0058](../adr/0058-the-order-after-payment.md)).

⚠️ **`/cancelling` and `/cancel` look alike and are not the same thing.** The
first takes the concurrency claim and is dispatched by the coordinator behind a
crossing guard; the second is the verb a person reaches. A browser reaching the first
would lock an order with no refund behind it.

⚠️ **Delivery is the shipment's; an order only follows it.** There is no
`fulfil` verb any more: a vendor dispatches and records delivery on their
`ShippingOrder` in fulfilment-service, and the delivery flow moves the order
`confirmed → dispatched → fulfilled` (or `cancelled` for a parcel refused or
returned) behind a crossing token
([ADR 0070](../adr/0070-fulfilment-and-cash-on-delivery.md)).

⚠️ **It holds the coordinator's inbound token and is a participant in the flow it
starts**, making it the third holder of that secret beside the storefront and
sales-service. The cycle is deliberate: a cancellation's authority is verifiable
only where the order lives, and handing the digest and the window to a slice that
declares no domain would put an order's authorization rule outside the order.

The cart is **not** here. It is a cookie, so the storefront's first response is
correct without a round trip, and the fleet keeps zero anonymous write surfaces.

⁶ **stock-service, bound.** The first of the five reserved indices to be
claimed. It owns the `stock` store — tenant plane, one Mongo database per
organization (`stock_<organizationId>`), beside the catalog's
`tenant_<organizationId>` rather than inside it — and serves the `StockItem`
reads and the append-only `StockMovement` ledger that moves them. Every route is
authenticated and organization-scoped; nothing here is readable anonymously,
because a vendor's stock position is exactly what a competitor would want, and
what the storefront shows about availability is a projection and a hint
([ADR 0010](../adr/0010-stock-ledger-reservations-and-concurrency.md)).

`POST /api/reservation` is the one platform→tenant crossing in the system, and
the single exception to "authenticated and organization-scoped" above — it is
authenticated by a **crossing token** (`x-crossing-token`, its own `is_secret`
configuration row, deliberately not the fleet's `CONFIG_SERVICE_TOKEN`) plus
`stock-management:reservation:write`, and scoped by an explicit
`x-organization-id`, because the organization comes from the item rather than
from the principal: checkout's buyer holds no membership in the vendor they are
buying from. It accepts **no session**, not even `super-admin`'s, since two
accepted credentials on one route means the weaker one is the security level
([ADR 0023](../adr/0023-service-to-service-tenant-crossing.md)). The reservation
_reads_ beside it are ordinary session-guarded tenant reads — one route, one
credential, each way.

⚠️ **`POST /api/stock-restoration` is the second crossing into this store**, and
the only other one in the fleet. A cancelled order's goods go back as a new
`+quantity` movement with `reason: 'cancellation'` — never as an un-conversion,
because by then the hold is spent and the ledger is append-only. Its permission
is `stock-management:stock-movement:restore` rather than the `stock-movement:write`
a vendor's own session holds, so a crossing token can write the one correction a
cancellation makes and not that vendor's whole ledger
([ADR 0058](../adr/0058-the-order-after-payment.md)). `reason` is server-owned,
and the route is idempotent on `Idempotency-Key` because the cancellation flow
dispatches it **after** its pivot.

⚠️ **A restoration names its cause, and a return is not a cancellation.** The
body carries a closed `cause: 'cancellation' | 'return'`, mapped server-side to
the movement's `reason`, so a parcel refused or returned goes back as a
`return` movement the ledger can tell apart (ADR 0070).

⚠️ **Every counter move announces `stock-item.changed`.** A movement, a hold
taken, released or converted, goods put back — each bumps the item's `version`
and emits the change at that version into the organization's own
`stock_<organizationId>` outbox in the same unit, drained at commit; the tenant
relay walks every `stock_*` database for what a drain left behind. The realtime
slice pushes it to the vendor's own open tabs, so availability moves without a
reload (#481).

Ending a hold is a **verb**, and there are two: `DELETE /api/reservation/:id`
releases one and `POST /api/reservation/:id/conversion` converts it to a sale.
Each carries its own crossing permission, and there is deliberately no `PUT` — a
generic save could rewrite a quantity or an expiry after the fact, which is a
hold that never expires granted by its holder. ⚠️ **Both answer `200` when the
hold was already gone.** They are compensations the checkout flow dispatches,
delivery is at-least-once, and a compensation that errors on its second delivery
strands a flow that had in fact been fully reversed; the body says which
happened. A sweep releases what expired, walking every `stock_<organizationId>`
database on an interval.

⁹ **sales-service, bound.** The third of the five reserved indices to be
claimed, and the one that finally gives a vendor a way to sell somewhere other
than this marketplace. It owns the `sales` store — **tenant** plane, one Mongo
database per organization (`sales_<organizationId>`), a third beside the
catalog's `tenant_<organizationId>` and stock's `stock_<organizationId>`. Same
plane, same partitioning, three stores with three writing slices, which is what
makes one-writer a property of the connection rather than of review
([ADR 0020](../adr/0020-stores-and-slices.md)).

It serves `SalesChannel` CRUD, session-guarded and organization-scoped like
every other tenant read in the fleet. Nothing here is readable anonymously and
nothing here accepts a crossing token **inbound**: a channel is authored by a
member of the organization that owns it, so a verified session is the only
credential any route accepts.

⚠️ **It owns the channel and never the sale.** A counter sale is a
`ProductOrder` with a `channel` on it, written by the checkout flow through
order-service — the same order the storefront produces, which is what keeps a
vendor's takings one query rather than two
([ADR 0024](../adr/0024-selling-through-a-vendors-own-channel.md)).

`POST /api/sales-channel/:id/sell`, the derived `sell` verb, is the till's one
write, and it persists nothing here.
It takes a **session and no token**, checks
`sales-management:sales-channel:sell`, loads the channel from the caller's own
tenant handle, re-prices every line from the published projection, and only then
presents the coordinator's inbound crossing token to
`POST /api/flow/checkout`, answering the till `202` with the checkout to follow.
So this process is the **second** holder of that
secret, beside the storefront — which holds it for the opposite reason, having no
session to check at all
([ADR 0056](../adr/0056-the-counter-sale-is-the-checkout-saga.md)).

¹¹ **realtime-service, bound** ([ADR 0072](../adr/0072-the-realtime-slice-flow-status-and-the-edge.md)),
inspector `9191`. It owns the `flow-status` store — platform plane, single, a
projection of the `workflow` journal — and serves the one push stream every tab
opens, `GET /api/realtime/stream`, which the edge routes to it on every origin,
and the catch-up a pending write settles from, `GET /api/realtime/flow/:id` and
`GET /api/realtime/flow?ids=…` — answered to the flow's organizations and
parties or to a capability by digest, and `404` to anyone else exactly as to a
flow not yet projected. The projection is its one `work` subscription, on
`flow.*` with an inbox claim, and an older version never overwrites a newer
one.
Every app's `dev` starts it, because a fleet without it is a back office whose
stream answers Envoy's `503`.

⚠️ **Every push subscription is a `broadcast`.** Each replica holds different
connections, so each binds its own exclusive queue for every pushable event, and
a message missed while a replica was down is caught up by the browser's
`resync` on reopen rather than redelivered. What a browser hears is decided by
a **push projection** in `@r10c/shells-effect-realtime`: a member whose role
grants the entity's read permission receives an `order.*` record itself, anyone
else a hint `{entity, change, id}` under its own registered name
(`entity.changed`); a publication is always a hint.

⚠️ **The audience filter fails closed.** Organization entries match the
session's `activeOrganizationId`, party entries its `partyId`, flow entries a
presented capability by SHA-256 digest; an event with no audience reaches
nobody. That is why `payment.*` is not pushed: it is registered with no
audience, and a capture names no vendor until it is allocated per order (#480).

It holds no crossing token and accepts none. A caller with neither a session nor
a capability is refused `401` **before** the stream opens, because a `401` on an
open `EventSource` kills it for good; a stream nearing its token's `exp` is sent
`event: reauth` instead. The SSE dials — the jittered `retry:` range, the reauth
margin and the drain window — are configuration rows.

¹⁰ **fulfilment-service, bound** ([ADR 0070](../adr/0070-fulfilment-and-cash-on-delivery.md)),
inspector `9110`, promoted by the commit that wrote its store (#483). It owns the
`fulfilment` store — **tenant** plane, one Mongo database per organization
(`fulfilment_<organizationId>`), a fourth beside the catalog's, stock's and
sales'. Same plane, same partitioning, a different writing slice, so a different
handle.

⚠️ **Two credentials on one surface, and each route takes exactly one.** A
vendor reads their own `ShippingOrder`s and moves them — `dispatch`,
`record-delivery`, `record-refusal`, `record-return` — behind their session and
the permission each `@useCase()` derives. A flow's steps are crossings with the
vendor named in `x-organization-id` and **no session**: `POST
/api/shipping-order` opens one, `POST|DELETE …/:id/hold` holds and releases it,
`…/:id/withdrawal` withdraws it, and `…/:id/dispatch-step` is the delivery flow's
pivot — each on its own crossing permission, so `dispatch-step` never carries the
vendor's `dispatch`.

⚠️ **Every move is one conditional write on the status it leaves**, so a dispatch
and a cancellation's hold racing on one shipment leave exactly one winner. A move
past dispatch announces `shipping-order.*` from the organization's own outbox,
drained at commit and walked by the tenant relay; the realtime slice pushes it to
the vendor, and the delivery flow waits on it.

⚠️ **A vendor's `dispatch` starts the delivery flow and moves nothing itself.**
It answers `202` with the flow to follow; the flow's pivot is `dispatch-step`,
so a shipment a cancellation holds is refused there and exactly one of the two
wins. The courier's reports — `record-delivery`, `record-refusal` and
`record-return` — stay plain moves whose events answer the flow's waits, and a
parcel is returned only after it was refused: one delivered is the delivery
flow's end.

**It holds its own crossing token, accepts the coordinator's, and holds the
coordinator's inbound one too** — `participant.fulfilmentToken` on
transaction-service and `service.token` here, plus `transaction.crossingToken`
to start a delivery — which makes it the fourth holder of that secret, and,
like order-service for a cancellation, a participant in the flow it starts.
Both app `dev` targets start it, since a checkout opens a shipment. Its
back-office surface is the dispatch worklist in `@r10c/shells-next-fulfilment`,
reached through a same-origin `/api/fulfilment` proxy (`fulfilment-service-domain`
in config-service) that forwards `GET` and `POST` only — the four verbs are the
only session-guarded writes, and every other write is a flow's crossing.

Adding a domain = next index → `300N` / `310N`, plus a seed row in config-service's
`configuration` table (`apps/config-service/src/db.ts`). Services resolve runtime
config from config-service (`GET /api/config/:service`); they never hardcode it.

⁴ `3002` is free. back-office-app on `:3001` serves the catalog, system
management, user administration **and** the account surface — one origin, which
is the point: a session established at sign-in is set on the very host the rest
of the back office is served from, so the cookie hop, the `AUTH_APP_URL`
indirection and the absolute cross-app account links all disappear. The auth
**domain** did not merge with marketplace-admin: its screens live in
`@r10c/shells-next-auth` (`scope:auth`), the host carries `scope:back-office`
and composes both, and splitting them apart again is a new app mounting that
shell. `auth-service` stays on `:3102` — it is what Zitadel calls back into.
Infrastructure NodePorts published to the host. **This table is generated** from
`infra/local/lib.sh` (`PORT_SPECS`, `LOGIN_NODEPORT`, `MINIKUBE_PORTS`) by
`tools/sync-docs.mjs` — add the port there, run `node tools/sync-docs.mjs`, and
stage the result. Editing between the markers fails the commit.

A port with no deployment is published but **not probed by the health ladder**:
it is a host-facing UI or a secondary protocol, and the ladder only walks the
listeners whose absence stops the fleet.

<!-- docs:begin ports-infra -->

| Host port | Datastore / UI         | Deployment      | Probed by the ladder |
| --------- | ---------------------- | --------------- | -------------------- |
| `30017`   | mongo                  | `mongodb`       | ✅                   |
| `30379`   | redis                  | `redis`         | ✅                   |
| `30672`   | rabbitmq               | `rabbitmq`      | ✅                   |
| `31672`   | rabbitmq management UI | —               | —                    |
| `30432`   | postgres               | `postgres`      | ✅                   |
| `30080`   | zitadel                | `zitadel`       | ✅                   |
| `30081`   | zitadel-login          | `zitadel-login` | ✅                   |
| `30000`   | grafana (otel-lgtm)    | —               | —                    |
| `30317`   | OTLP/gRPC (otel-lgtm)  | —               | —                    |
| `30318`   | otel                   | `otel-lgtm`     | ✅                   |
| `30825`   | mailpit                | `mailpit`       | ✅                   |
| `30826`   | mailpit web UI         | —               | —                    |

<!-- docs:end ports-infra -->

Mailpit is two ports: **30825** is SMTP (what services dial) and **30826** is the
web UI (where you read the mail).

Zitadel is load-bearing, not optional: auth-service cannot sign anyone in without
it, and its readiness probe says so. The hosted login carries the same weight and
is a **second container** — the core serves nothing under `/ui/v2/login`, so a
fleet without `:30081` answers 404 at sign-in while every probe stays green
([ADR 0018](../adr/0018-the-hosted-login-is-a-second-container.md)). Mailpit is
where every provider mail lands in the local lab.
