<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

`-app` frontends bind **300N**, `-service` backends bind **310N**, cross-cutting
platform services use **319x**; the domain index `N` is shared per frontend/backend
pair. Infra exposes minikube NodePorts at `30000 +` the canonical port.

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
| — platform —            |        | config-service 3190 |

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

The difference from the version that was deleted is exactly the thing ADR 0020
made sayable: a deployment earns its existence by owning a store.

³ **transaction-service, bound — and this index is the one that proves the
claim it was reserved on.** The `transaction` slice was **co-deployed** into
marketplace-admin-service, and the note here said that ownership had not moved,
only the process, so splitting it back out would mean pointing its declaration
in `tools/slices/` at a new app rather than untangling a database.

That is exactly what happened on 2026-09-08 (#229). ADR 0039 deferred the split
with a stated condition — _"the first flow with a participant outside
marketplace-admin-service"_ — and checkout's participants turned out to be
stock-service (`:3108`) and order-service (`:3105`). The trigger fired; the
`saga` store's handle was already an explicit `client.db(name)`, so the module
moved unchanged and no data moved at all.

It serves `/api/transaction/:id` and `/api/transaction/events` — both
authenticated and organization-scoped since
[ADR 0036](../adr/0036-the-reactive-stream-is-server-sent-and-same-origin.md) —
plus `POST /api/saga/:definition`, the coordinator that walks a declarative flow
([ADR 0052](../adr/0052-the-checkout-saga.md)). That route is generic rather than
`/api/checkout` because this slice declares **no domain**, and a business verb
here would put a domain name in a permission namespace nothing is provisioned
for.

It now knows **two** definitions: `checkout`, and `cancellation` — claim the
order, refund, restore the stock, close the record. That second one is what ADR
0052 named as the trigger to reconsider the step grammar, and the answer was that
the grammar held: the flow is sequential with one fan-out, which `defineSaga`
already expresses ([ADR 0058](../adr/0058-the-order-after-payment.md) §7). Both
run on `order-management:product-order:write`, so neither adds an entry to
`SERVICE_CROSSING_PERMISSIONS`; registering a definition is what makes it
resumable, because the sweep looks an instance's flow up by name.

`GET /api/saga/:id` answers where a flow stopped and what has been reversed. It
is scoped to the organizations the flow's own **calls** named rather than to one
member on the record, because a basket spanning two vendors belongs to both — and
for the same reason it carries no permission of its own
([ADR 0055](../adr/0055-a-coordinator-resumes-from-its-own-record.md)).

It also runs a **second** sweep beside the tracker's. The recovery sweep labels
stuck single-step transaction records `STALE`; the resume sweep finishes
multi-step flows whose coordinator died, claiming each instance with a
conditional write so two replicas cannot walk one flow together. Both are
config-service dials and they are deliberately separate ones.

⚠️ **The browser's path did not change, and could not.** Those two reads move
from `:3101` to `:3103` behind the back office's own same-origin proxy, which
gains a `transaction-service-domain` config row and an `/api/transaction`
rewrite. The stream is same-origin by _necessity_ — the session cookie is
`httpOnly` and an `EventSource` aimed at the service directly carries no
credential — and the catalog's `202` link is relative, so no caller ever encoded
either arrangement.

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

⚠️ **It subscribes to two events, and neither is sufficient alone.**
`payment.captured` says money moved and names the order; it carries no vendor
lines and only a channel _id_, which points into a tenant store this slice cannot
open. `order.placed` carries the vendor-tagged lines and the channel _type_
copied onto the receipt. So the two are joined on the order id and whichever
completes the pair writes the commission entries
([ADR 0057](../adr/0057-settlement-joins-the-sale-to-its-payment.md)). This is
the consumer ADR 0054 said `order.placed` was being drained for.

It publishes `settlement.run.completed` from an outbox in its own store. Nothing
consumes it yet — a payouts process is what would, and that is not built.

⚠️ **It holds no crossing token and accepts none.** Both of its inputs arrive on
the bus, so nothing dispatches into it, and every route it serves is guarded by a
verified session. It is the only slice in the fleet with a store, a bus
connection and no service secret at all.

**`back-office:dev` starts it**, unlike order-service, payment-service and
transaction-service, because it has a back-office surface: a vendor's terms and
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

⚠️ **`POST /api/payment` is the checkout saga's pivot**, and the only write in
the fleet that cannot be compensated. It takes a **crossing token and no
session** — the buyer behind a checkout holds no grant over the capture made on
their behalf — while its reads take a session and no token. One route, one
credential, each way. Its crossing permission is therefore an unpaired entry in
`SERVICE_CROSSING_PERMISSIONS`: a refund is a new record with its own money
movement, not the absence of this one
([ADR 0054](../adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
It was the **only** such entry until the refund below became the second.

⚠️ **`POST /api/refund` is the _cancellation_ saga's pivot**, and the second
write here that cannot be compensated. It takes a crossing token and no session
for the same reason the capture does, and it is addressed by **order id** — the
saga holds an order and has never seen a payment — resolving the capture itself
and copying the amount off it rather than reading one from the request. A
`Refund` is its own record: ADR 0054 protects the capture row as the evidence a
customer was charged, so a `'refunded'` status written over it would erase that
evidence by another route ([ADR 0058](../adr/0058-the-order-after-payment.md)).
Two guards stop a double refund and they answer different questions —
`x-command-id` covers a redelivery of one command, a unique index on the refund's
`paymentId` covers two different commands aimed at one capture.

⚠️ **`payment-management:refund:write` is therefore a _second_ unpaired crossing
permission, not the pairing the note above says `payment:write` lacks.** Filing
it as one would be backwards: it is a new money movement whose own reversal
question has the same answer, because un-refunding is charging a customer again.

It publishes `payment.captured`, `payment.failed` and `payment.refunded` from an
outbox in its own store. The capture _decision_ never arrives as a message — the saga dispatches
it — so what the bus carries is the consequence: order-service advances an order
to `paid`, and settlement will fold a commission entry in M6.

⚠️ **No dev target starts it.** Like order-service and transaction-service it is
not a dependency of either frontend's `dev`, so a live checkout needs it started
by hand — `node apps/payment-service/dist/main.js` — or the saga's pivot fails
against an address nothing is listening on.

⁷ **order-service, bound.** It owns the `order` store — **platform** plane and
single, one named database, which is the opposite of stock's per-request tenant
handle beside it. That is forced rather than chosen: a basket can span several
vendors, so one order cannot live in any one of their tenant databases. The
multi-vendor case rides on vendor-tagged embedded lines instead, so the buyer
gets one receipt and settlement still aggregates per vendor
([ADR 0022](../adr/0022-v1-marketplace-module-boundaries.md)).

⚠️ **It reserves nothing itself.** ADR 0023's crossing into stock is dispatched
by transaction-service, which holds both halves of the checkout flow; this
service is a _participant_. The checkout writes accept a **crossing token and no
session** — the buyer behind a checkout holds no grant over the receipt written
on their behalf — while its reads accept a session and no token. One route, one
credential, each way ([ADR 0052](../adr/0052-the-checkout-saga.md)).

`DELETE /api/product-order/:id` is a **compensation**, not a customer-facing
cancel: it undoes a step that should not have happened. A cancellation is a
business event with its own record and its own money consequences, and it is
`POST /api/product-order/:id/cancellation`.

⚠️ **Three credentials on one surface, and each route still takes exactly one.**
`fulfil` and `cancellation` are session-guarded by the permissions their own
`@useCase()` descriptors derive — there is still no `product-order:write` for any
role, and these are verbs rather than saves. `buyer-cancellation` takes the nonce
from a storefront receipt and **no session at all**: the order stores that
nonce's SHA-256 digest, so the record is the authority and the credential is
inert wherever else it travels. The saga's own `cancelling` and `cancelled` steps
take a crossing token
([ADR 0058](../adr/0058-the-order-after-payment.md)).

⚠️ **`/cancelling` and `/cancellation` are one letter apart and are not the same
thing.** The first takes the concurrency claim and is dispatched by the
coordinator; the second is what a person reaches. A browser reaching the first
would lock an order with no refund behind it.

⚠️ **Fulfilment is per line; cancellation is per order.** `OrderItem` carries
`fulfilledAt` and the order reaches `fulfilled` only once every line has one, so
one vendor cannot state something true about another's lines. A vendor may cancel
only an order that is theirs alone and gets `409 multiVendorOrder` otherwise —
the money was taken once, for the whole basket, on one capture.

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
and the route is idempotent on `x-command-id` because the cancellation saga
dispatches it **after** its pivot.

Ending a hold is a **verb**, and there are two: `DELETE /api/reservation/:id`
releases one and `POST /api/reservation/:id/conversion` converts it to a sale.
Each carries its own crossing permission, and there is deliberately no `PUT` — a
generic save could rewrite a quantity or an expiry after the fact, which is a
hold that never expires granted by its holder. ⚠️ **Both answer `200` when the
hold was already gone.** They are compensations the checkout saga dispatches,
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
`ProductOrder` with a `channel` on it, written by the checkout saga through
order-service — the same order the storefront produces, which is what keeps a
vendor's takings one query rather than two
([ADR 0024](../adr/0024-selling-through-a-vendors-own-channel.md)).

`POST /api/counter-sale` is the till's one write, and it persists nothing here.
It takes a **session and no token**, checks
`sales-management:sales-channel:sell`, loads the channel from the caller's own
tenant handle, re-prices every line from the published projection, and only then
presents the coordinator's inbound crossing token to
`POST /api/saga/checkout`. So this process is the **second** holder of that
secret, beside the storefront — which holds it for the opposite reason, having no
session to check at all
([ADR 0056](../adr/0056-the-counter-sale-is-the-checkout-saga.md)).

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
