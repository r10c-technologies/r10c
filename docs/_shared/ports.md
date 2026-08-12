<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

`-app` frontends bind **300N**, `-service` backends bind **310N**, cross-cutting
platform services use **319x**; the domain index `N` is shared per frontend/backend
pair. Infra exposes minikube NodePorts at `30000 +` the canonical port.

| Domain (`N`)            | `-app` | `-service`          |
| ----------------------- | ------ | ------------------- |
| marketplace (0)         | 3000   | 3100²               |
| marketplace-admin (1)   | 3001⁴  | 3101                |
| auth (2)                | —⁴     | 3102                |
| transaction-manager (3) | —³     | —³                  |
| system-management (4)   | 3004¹  | —                   |
| order (5)               | —      | 3105⁵               |
| payment (6)             | —      | 3106⁵               |
| settlement (7)          | —      | 3107⁵               |
| stock (8)               | —      | 3108⁵               |
| — platform —            |        | config-service 3190 |

**The index is per host, not per pair.** ADR 0008 allocated `300N`/`310N` to
frontend/backend _pairs_, which stopped describing the fleet the moment one host
began serving two domains. A domain still owns its `-service` index; what it no
longer implies is a frontend of its own.

¹ Reserved, not built. The system-management screens live in the `scope:shared`
shell `@r10c/shells-next-system-management` and are mounted by
back-office-app today; the dedicated bastion app takes this index when it
lands, and needs no `-service` of its own (config-service is its backend).

² **marketplace-service, back on `:3100`.** It was deleted by
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

The difference from the version that was deleted is exactly the thing ADR 0020
made sayable: a deployment earns its existence by owning a store.

³ `3103` is free. The `transaction` slice still exists and still owns the `saga`
store; it is **co-deployed** into marketplace-admin-service rather than running
as its own process. That distinction is the point: ownership did not move, only
the process did, so splitting it back out means pointing its declaration in
`tools/slices/` at a new app and reclaiming this index — not untangling a
database. It serves `/api/transaction{,/:id}` on `:3101`, and the catalog's
`202` link is relative so callers never encoded either arrangement.

⁵ **Reserved, not bound.** The `order`, `payment`, `settlement` and `stock`
slices exist in the register and own their stores, but are `planned` — no process
runs them, so nothing listens on these ports yet
([ADR 0022](../adr/0022-v1-marketplace-module-boundaries.md)). The index is
allocated now so that promoting a slice is a `deployments` edit rather than a
port negotiation. They are deliberately **not** in `ALL_PORTS`
(`tools/free-ports.sh`) until something binds them.

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
Infrastructure NodePorts published to the host, declared once in
`infra/local/lib.sh` (`PORT_SPECS`) and mirrored here:

| Datastore                     | Host port                             |
| ----------------------------- | ------------------------------------- |
| MongoDB                       | 30017                                 |
| Redis                         | 30379                                 |
| RabbitMQ                      | 30672                                 |
| Postgres                      | 30432                                 |
| otel-lgtm                     | 30318                                 |
| **Zitadel**                   | **30080**                             |
| **Zitadel hosted login (v2)** | **30081**                             |
| **Mailpit**                   | **30825** (SMTP) / **30826** (web UI) |

Zitadel is load-bearing, not optional: auth-service cannot sign anyone in without
it, and its readiness probe says so. The hosted login carries the same weight and
is a **second container** — the core serves nothing under `/ui/v2/login`, so a
fleet without `:30081` answers 404 at sign-in while every probe stays green
([ADR 0018](../adr/0018-the-hosted-login-is-a-second-container.md)). Mailpit is
where every provider mail lands in the local lab.
