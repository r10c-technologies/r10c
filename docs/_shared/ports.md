<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

`-app` frontends bind **300N**, `-service` backends bind **310N**, cross-cutting
platform services use **319x**; the domain index `N` is shared per frontend/backend
pair. Infra exposes minikube NodePorts at `30000 +` the canonical port.

| Domain (`N`)            | `-app` | `-service`          |
| ----------------------- | ------ | ------------------- |
| marketplace (0)         | 3000   | —²                  |
| marketplace-admin (1)   | 3001   | 3101                |
| auth (2)                | 3002   | 3102                |
| transaction-manager (3) | —      | 3103                |
| system-management (4)   | 3004¹  | —                   |
| — platform —            |        | config-service 3190 |

¹ Reserved, not built. The system-management screens live in the `scope:shared`
shell `@r10c/shells-next-system-management` and are mounted by
marketplace-admin-app today; the dedicated bastion app takes this index when it
lands, and needs no `-service` of its own (config-service is its backend).

² `3100` is free. marketplace-service existed as a 36-line health-check shell
with no router, no store and no domain — under ADR 0020 that is not a Slice, and
a placeholder deployment is a thing to keep booting, probe and reason about for
no return. The storefront reads its catalog through
`@r10c/shells-next-marketplace`'s fixture repository until there is something
real to serve. [ADR 0009](../adr/0009-catalog-authoring-and-publication.md)
brings the backend back under its own name — `published-catalog` — when the
published catalog exists; it reclaims this index.

Adding a domain = next index → `300N` / `310N`, plus a seed row in config-service's
`configuration` table (`apps/config-service/src/db.ts`). Services resolve runtime
config from config-service (`GET /api/config/:service`); they never hardcode it.

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
