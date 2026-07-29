# Local infrastructure (`infra/local`)

Local Kubernetes platform for the marketplace fleet, running on Minikube:
**MongoDB**, **Redis**, **RabbitMQ** (transaction event bus), **PostgreSQL**,
**otel-lgtm** (Grafana stack), and — opt-in — **Zitadel**. Everything lives in
the `marketplace-local-infra` namespace.

> This is the `local` environment. Future environments would sit beside it as
> `infra/staging`, `infra/prod`, etc.

---

## Just run the app

```bash
pnpm run mp-admin:dev        # self-heals whatever is broken, then starts the app
pnpm run mp-admin:dev:reset  # recreate the datastores first (wipes local data)
pnpm run dev-infra:doctor    # read-only: where the ladder stands, and the fix
```

Nothing below is required day to day — `mp-admin:dev` brings the cluster up,
applies missing manifests, and waits for the datastores by itself. See
[Self-healing](#self-healing) for what it will and will not do on its own.

---

## Prerequisites

- [minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) (with built-in `kustomize`)
- `openssl` (used by `apply.sh` to generate the Zitadel master key)

Optional, and only sharpen the health probes when present: `pg_isready`,
`redis-cli`, `mongosh`, `docker`.

---

## Secrets

Nothing secret is committed. Each platform folder ships a committed
`.env.example`; `apply.sh` copies it to a git-ignored `.env` (see
`.gitignore`) and feeds it to a kustomize `secretGenerator`. The Zitadel master
key is generated randomly into `zitadel/.env` on first run.

To customise credentials, edit the generated `.env` files (not the examples).
All defaults are labelled **LOCAL DEV ONLY** — never reuse them.

---

## Self-healing

`ensure.sh` is the `ensure-infra` nx target every backend `dev` depends on, so
it runs 3-4 times per app boot. It walks a ladder and heals only the broken
rung; a healthy cluster costs ~0.1s (five TCP probes plus one `get deploy`).

| Rung         | Check                               | Heal                              |
| ------------ | ----------------------------------- | --------------------------------- |
| L0 tooling   | `minikube` / `kubectl` / `nc`       | — reports the `brew install` line |
| L1 cluster   | minikube `Running`                  | `minikube start --ports …`        |
| L2 portmap   | NodePorts published to `127.0.0.1`  | — needs `reset.sh --hard`         |
| L3 workloads | namespace + deployments exist       | `apply.sh`                        |
| L4 rollout   | each deployment has a Ready replica | delete the pod once, re-wait      |
| L5 probes    | TCP + protocol handshake            | back to L4                        |

Two things it does **not** do, on purpose: it never deletes data, and it never
recreates the cluster. Both are `reset.sh`'s job, and it exits naming the exact
command when it hits one of them.

> **A socket that answers proves nothing.** With the docker driver,
> docker-proxy keeps a published NodePort accepting connections after the pod
> behind it is gone — `kubectl -n marketplace-local-infra delete deploy mongodb`
> and the port stays open. That is why readiness is part of the fast-path
> question and not just TCP.

Parallel `ensure-infra` tasks serialise on `infra/local/.heal.lock`
(git-ignored): the first heals, the rest wait and re-probe.

---

## Reset (the destructive heal)

```bash
pnpm run mp-admin:dev:reset      # confirm, recreate datastores, start the app
bash infra/local/reset.sh        # datastores only
bash infra/local/reset.sh --hard # also delete + recreate the minikube cluster
bash infra/local/reset.sh --yes  # skip the confirmation (CI/scripts)
```

Reset exists for the class of problem `ensure.sh` refuses to touch: **bad
data**. Mongo docs written by an older seed, drifted `configuration` rows in
Postgres (the seed is `INSERT … ON CONFLICT DO NOTHING`, so a wrong value is
never corrected in place), a wedged data directory. It fixes them by throwing
the data away — namespace, PVs, _and_ the hostPaths a plain `teardown.sh`
leaves behind — and letting service boot rebuild it: config-service re-seeds
its table, auth-service reconciles its seed identities into an empty Mongo.

It also clears the nx cache and `apps/*/.next`, so a fresh datastore is not
paired with a stale build.

`--hard` is the only fix for a cluster created without `--ports` (a plain
`minikube start`), because that mapping is set at creation time.

---

## Start / Stop by hand

```bash
# Start cluster, exposing every NodePort to localhost
minikube start --ports 30017:30017,30379:30379,30672:30672,31672:31672,30432:30432,30080:30080,30000:30000,30317:30317,30318:30318

# Stop cluster (data persists)
minikube stop
```

The port list is duplicated here for reading only; the one the scripts use is
`MINIKUBE_PORTS` in [`lib.sh`](lib.sh), which also owns the namespace, the
datastore→NodePort→deployment table, and the probes. Adding a datastore is one
line there plus its kustomize folder.

---

## Deploy everything by hand

```bash
./apply.sh      # creates .env files, applies the kustomize targets
./teardown.sh   # removes workloads; keeps PV data (see Reset to wipe it)
```

Zitadel is **opt-in**: nothing in the fleet authenticates against it today
(auth-service owns credentials), and it costs a Postgres rollout wait plus
~1min of self-init on every apply. Include it with:

```bash
INFRA_INCLUDE_ZITADEL=1 ./apply.sh
```

### Status

```bash
pnpm run dev-infra:doctor                           # ladder view + the fix
kubectl get pods,pvc,svc -n marketplace-local-infra # raw
```

---

## Connect from a local app

No port-forward needed — the cluster is started with `--ports`, so each
NodePort is reachable on `127.0.0.1`.

| Platform   | URL / DSN                                                                               | Creds source      |
| ---------- | --------------------------------------------------------------------------------------- | ----------------- |
| MongoDB    | `mongodb://admin:password@127.0.0.1:30017`                                              | `mongodb/.env`    |
| Redis      | `redis://:localdev@127.0.0.1:30379` (`redis-cli -p 30379 -a localdev ping`)             | `redis/.env`      |
| RabbitMQ   | `amqp://admin:password@127.0.0.1:30672` · management UI `http://localhost:31672`        | `rabbitmq/.env`   |
| PostgreSQL | `postgres://postgres:postgres@127.0.0.1:30432/postgres`                                 | `postgres/.env`   |
| Zitadel    | console `http://localhost:30080` (admin `zitadel-admin`, pw in `zitadel/.env`)          | `zitadel/.env`    |
| otel-lgtm  | Grafana `http://localhost:30000` (anonymous admin) · OTLP/HTTP `http://127.0.0.1:30318` | — (dev, no creds) |

---

## Per-platform manifests

```
infra/local/
  00-namespace.yaml
  apply.sh  teardown.sh
  mongodb/  redis/  postgres/  zitadel/    # each: kustomization + manifests + .env.example
```

Each folder is a kustomize target: `kubectl apply -k infra/local/<platform>`.
Preview rendered output with `kubectl kustomize infra/local/<platform>`.

### Open a shell

```bash
# mongosh
kubectl exec -it -n marketplace-local-infra \
  $(kubectl get pod -n marketplace-local-infra -l app=mongodb -o jsonpath='{.items[0].metadata.name}') \
  -- mongosh -u admin -p password

# psql
kubectl exec -it -n marketplace-local-infra \
  $(kubectl get pod -n marketplace-local-infra -l app=postgres -o jsonpath='{.items[0].metadata.name}') \
  -- psql -U postgres
```

---

## Full reset (deletes data)

```bash
./teardown.sh
kubectl delete ns marketplace-local-infra
minikube ssh -- sudo rm -rf \
  /data/marketplace-mongodb /data/marketplace-redis /data/marketplace-postgres
```
