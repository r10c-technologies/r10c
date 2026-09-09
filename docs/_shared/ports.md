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
| sales (9)               | —      | 3109⁵               |
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
([ADR 0052](../adr/0052-the-checkout-saga.md)). The route is generic rather than
`/api/checkout` because this slice declares **no domain**, and a business verb
here would put a domain name in a permission namespace nothing is provisioned
for.

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

⁵ **Reserved, not bound.** The `settlement` and `sales` slices exist in the
register and own their stores, but are `planned` — no process runs them, so
nothing listens on these ports yet
([ADR 0022](../adr/0022-v1-marketplace-module-boundaries.md),
[ADR 0024](../adr/0024-selling-through-a-vendors-own-channel.md)). The index is
allocated now so that promoting a slice is a `deployments` edit rather than a
port negotiation. They are deliberately **not** in `ALL_PORTS`
(`tools/free-ports.sh`) until something binds them.

`payment` was on this list until #152 and is now footnote 8, which is the
mechanism working: promoting it was a `deployments` edit and a `FLEET` entry,
exactly as the reservation promised.

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
credential, each way. Its crossing permission is therefore the only unpaired
entry in `SERVICE_CROSSING_PERMISSIONS`: a refund is a new record with its own
money movement, not the absence of this one
([ADR 0054](../adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).

It publishes `payment.captured` and `payment.failed` from an outbox in its own
store. The capture _decision_ never arrives as a message — the saga dispatches
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
service is a _participant_. Its two writes accept a **crossing token and no
session** — the buyer behind a checkout holds no grant over the receipt written
on their behalf — while its reads accept a session and no token. One route, one
credential, each way ([ADR 0052](../adr/0052-the-checkout-saga.md)).

`DELETE /api/product-order/:id` is a **compensation**, not a customer-facing
cancel: it undoes a step that should not have happened. A cancellation is a
business event with its own record and its own money consequences, and it is not
served yet.

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

Releasing and converting a hold, and the sweep that expires one, are not served
yet.

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
