<!-- Single source imported by CLAUDE.md and docs/ARCHITECTURE.md. Edit here only. -->

`-app` frontends bind **300N**, `-service` backends bind **310N**, cross-cutting
platform services use **319x**; the domain index `N` is shared per frontend/backend
pair. Infra exposes minikube NodePorts at `30000 +` the canonical port.

| Domain (`N`)            | `-app` | `-service`          |
| ----------------------- | ------ | ------------------- |
| marketplace (0)         | 3000   | 3100                |
| marketplace-admin (1)   | 3001   | 3101                |
| auth (2)                | 3002   | 3102                |
| transaction-manager (3) | —      | 3103                |
| — platform —            |        | config-service 3190 |

Adding a domain = next index → `300N` / `310N`, plus a seed row in config-service's
`configuration` table (`apps/config-service/src/db.ts`). Services resolve runtime
config from config-service (`GET /api/config/:service`); they never hardcode it.
