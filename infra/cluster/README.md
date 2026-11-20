# infra/cluster

Everything that runs **inside** the cluster ([ADR 0083](../../docs/adr/0083-the-fleet-runs-on-gcp-on-demand.md));
the cloud resources around it are [`infra/gcp/`](../gcp/README.md). **Nothing
here is applied** before MVP-7 (#702) — every environment is the local lab in
[`infra/local/`](../local/README.md) — and CI renders the whole tree with
`kubectl kustomize infra/cluster` and validates every document against its
schema (`kubeconform -strict`), so the shape is right on the day it first is.

| Directory                           | What                                                                                                               | Written by                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `kustomization.yaml`                | the whole tree, as `kubectl apply --server-side -k infra/cluster` takes it                                         | hand-written                                                         |
| `fleet/`                            | a `Deployment` and `Service` per service and Next app, transaction-service's runner, the `fleet-env` map           | **generated** from `FLEET` (tools/slices) and `ORIGINS` (tools/edge) |
| `edge/`                             | Envoy Gateway: the `Gateway`, one `HTTPRoute` per origin, and the client and backend policies                      | **generated** from `tools/edge/src/routes.ts`                        |
| `platform/`                         | the `r10c` namespace, the `retained` storage class, RabbitMQ, Redis, Zitadel and its login, OTel agent and gateway | hand-written (#681)                                                  |
| `vendor/envoy-gateway/`             | Envoy Gateway v1.9.3's release manifest: Gateway API CRDs and the controller that serves `edge/`                   | upstream, unmodified                                                 |
| `vendor/rabbitmq-cluster-operator/` | the RabbitMQ Cluster Operator v2.23.1's release manifest                                                           | upstream, unmodified                                                 |
| `vendor/cert-manager/`              | cert-manager v1.21.3's release manifest: the issuer of the edge's certificate                                      | upstream, with the Gateway API turned on by a kustomize patch        |

- **Generated directories** fail `@r10c/docs-check` on a hand-edit. Change the
  source and run `pnpm nx run @r10c/cluster:generate` (fleet) or
  `pnpm nx run @r10c/edge:generate` (edge). A service added to the slice
  register's `FLEET` becomes a workload with no YAML written by hand.
- **Vendored releases** are upstream's files byte for byte. Upgrading is
  replacing the file with a newer release's, so the diff is the upgrade.
- **Every volume claims `retained`** (`reclaimPolicy: Retain`), so "down"
  scaling the pool to zero, or a deleted claim, never takes a disk with it
  (ADR 0083 §5).

## Images

Every service and both Next apps build an image, and CI builds them on every
change without pushing (`build-apps` runs `container` beside `build`):

```sh
pnpm nx run order-service:container     # r10c/order-service:local
pnpm nx run marketplace-app:container   # r10c/marketplace-app:local
```

- A service's image is `tools/docker/service.Dockerfile` over what
  `<service>:prune` leaves in its `dist`: the bundle, a package.json of what it
  keeps external, a lockfile pruned to it, installed `--prod --frozen-lockfile`.
  transaction-service's runner-only replica runs `runner.js` from the same image.
- A Next app's image is `tools/docker/next.Dockerfile` over
  `output: 'standalone'`, and installs nothing.
- Both run as a numeric non-root user on Node 26.4, pinned by digest.
- The manifests name `r10c/<project>:local`. The up command pushes each to
  Artifact Registry tagged with the commit and renames it in a generated
  overlay (`infra/.overlay/`, gitignored), so the tree here never changes per
  environment.

## What the manifests name and the up command supplies

Nothing here holds a secret value or an address only the cloud knows. Each is
referenced by name, and the up command (`pnpm run infra:up`, `tools/infra`)
writes it before the workloads that read it, from Secret Manager or from
`tofu output` (ADR 0083, #683, #685):

| Name                      | Kind      | Read by                                                                     | From                                                              |
| ------------------------- | --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `fleet-token`             | Secret    | every service and app (`CONFIG_SERVICE_TOKEN`)                              | generated                                                         |
| `config-service-database` | Secret    | config-service (`CONFIG_PG_URL`)                                            | its Cloud SQL user's generated password                           |
| `config-seed`             | Secret    | config-service: the cluster seed's inputs (`cluster-seed.ts`)               | every token, URI and key below, assembled after the identity seed |
| `redis-secret`            | Secret    | Redis                                                                       | generated                                                         |
| `zitadel-secret`          | Secret    | Zitadel: master key, database passwords, first admin's password             | generated                                                         |
| `zitadel-login-secret`    | Secret    | the hosted login: its PAT                                                   | minted by Zitadel at first init, read back through `pat-reader`   |
| `storefront-tokens`       | Secret    | marketplace-app: the coordinator's and the lookup crossing tokens           | generated, the same values the services' rows hold                |
| `posthog`                 | Secret    | both Next apps' `/api/analytics`                                            | provided, `{}` for none                                           |
| `grafana-cloud`           | Secret    | the OTel gateway                                                            | provided                                                          |
| `rabbitmq-default-user`   | Secret    | the up command, for the bus URI row                                         | written by the operator                                           |
| `edge-tls`                | Secret    | the edge                                                                    | cert-manager, from Let's Encrypt                                  |
| `cloud-endpoints`         | ConfigMap | Zitadel, its login and both apps: the Cloud SQL address, the public origins | `tofu output`                                                     |

The manifests name the public domain as `r10c.invalid` and the edge's address
as `192.0.2.1`, both reserved for exactly this; the up command substitutes the
real ones from `tofu output` before it applies anything, so an unsubstituted
manifest can answer for nobody's name.

config-service seeds the cluster's rows, not the lab's: the lab seed rewritten
to the cluster's addresses and secrets
(`apps/config-service/src/cluster-seed.ts`), and a row still holding a lab value
fails its boot.

## Telemetry and its free tier

Grafana Cloud's free tier, read on 2026-11-20 at grafana.com/pricing: 10k
active metric series, 50 GB of logs and 50 GB of traces a month, 14 days'
retention. What keeps the fleet inside it:

- **Metrics** are counted in active series, and an interval does not change a
  series count. With the rehearsal fleet running on minikube and exporting
  to the lab's Prometheus (`pnpm run infra:up -- --target lab`), it held 184
  active series on 2026-11-20, idle. Traffic adds a series per route and
  status a service answers, so a demo stays in the hundreds, far under 10k.
  Each service exports once a minute (`otel.metricIntervalMs`).
- **Traces**: every probe's span is dropped at the gateway — a kubelet asking
  each pod every 5 s is most of an idle fleet's traces — and 25 % of the rest
  are kept, by trace id, so a kept trace is whole.
- **Logs** leave at `info` (`logging.level`), not the lab's `debug`.

## Inside the cluster, different from the lab

- **transaction-service's runners register at their pod's address.** Each pod
  is handed `status.podIP` as `WORKFLOW_RUNNER_HOST`, which overrides the
  `workflow.runnerHost` row; the lab sets neither and keeps `127.0.0.1`.
- **Telemetry stays on its node.** Every service names one `otel.endpoint`, and
  the agent's `Service` uses `internalTrafficPolicy: Local`, so a pod reaches
  the agent beside it; only the gateway holds the Grafana Cloud credential.
- **Zitadel serves plain HTTP behind the edge** (`--tlsMode external`) and
  reaches Cloud SQL encrypted (`require`). The lab's outgoing-HTTP denylist
  override does not exist here.
