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
- The manifests name `r10c/<project>:local`. Pushing to Artifact Registry and
  pointing the manifests at it is the up command's (#685).

## What the manifests name and something else supplies

Nothing here holds a secret value or an address only the cloud knows. Each is
referenced by name, and its value has a source of its own:

| Name                      | Kind      | Read by                                                           | Supplied by              |
| ------------------------- | --------- | ----------------------------------------------------------------- | ------------------------ |
| `fleet-token`             | Secret    | every service and app (`CONFIG_SERVICE_TOKEN`)                    | #683                     |
| `config-service-database` | Secret    | config-service (`CONFIG_PG_URL`)                                  | #683                     |
| `redis-secret`            | Secret    | Redis                                                             | #683                     |
| `zitadel-secret`          | Secret    | Zitadel: master key, database passwords                           | #683                     |
| `zitadel-login-secret`    | Secret    | the hosted login: its PAT                                         | #685's seed              |
| `grafana-cloud`           | Secret    | the OTel gateway                                                  | #684                     |
| `rabbitmq-default-user`   | Secret    | written by the operator; the bus URI row                          | the operator             |
| `cloud-endpoints`         | ConfigMap | Zitadel and its login: the Cloud SQL address, the identity domain | #685, from `tofu output` |

The configuration rows every service reads — the Mongo, bus and Redis URIs,
`otel.endpoint` (`http://otel-agent:4318` in the cluster) — are config-service's
production seed (#683).

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
