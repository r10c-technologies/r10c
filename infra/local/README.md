# Local infrastructure (`infra/local`)

Local Kubernetes platform for the marketplace fleet, running on Minikube:
**MongoDB**, **Redis**, **RabbitMQ** (transaction event bus), **PostgreSQL**, and
**Zitadel** (identity, backed by Postgres). Everything lives in the
`marketplace-local-infra` namespace.

> This is the `local` environment. Future environments would sit beside it as
> `infra/staging`, `infra/prod`, etc.

---

## Prerequisites

- [minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) (with built-in `kustomize`)
- `openssl` (used by `apply.sh` to generate the Zitadel master key)

---

## Secrets

Nothing secret is committed. Each platform folder ships a committed
`.env.example`; `apply.sh` copies it to a git-ignored `.env` (see
`.gitignore`) and feeds it to a kustomize `secretGenerator`. The Zitadel master
key is generated randomly into `zitadel/.env` on first run.

To customise credentials, edit the generated `.env` files (not the examples).
All defaults are labelled **LOCAL DEV ONLY** — never reuse them.

---

## Start / Stop

```bash
# Start cluster, exposing every NodePort to localhost
minikube start --ports 30017:30017,30379:30379,30672:30672,31672:31672,30432:30432,30080:30080,30000:30000,30317:30317,30318:30318

# Stop cluster (data persists)
minikube stop
```

---

## Deploy everything

```bash
./apply.sh      # creates .env files, generates master key, applies in order
./teardown.sh   # removes workloads; keeps PV data
```

`apply.sh` applies datastores first, waits for Postgres to be ready, then
Zitadel (which self-initialises its schema against Postgres).

### Status

```bash
kubectl get pods,pvc,svc -n marketplace-local-infra
```

---

## Connect from a local app

No port-forward needed — the cluster is started with `--ports`, so each
NodePort is reachable on `127.0.0.1`.

| Platform | URL / DSN | Creds source |
|---|---|---|
| MongoDB | `mongodb://admin:password@127.0.0.1:30017` | `mongodb/.env` |
| Redis | `redis://:localdev@127.0.0.1:30379` (`redis-cli -p 30379 -a localdev ping`) | `redis/.env` |
| RabbitMQ | `amqp://admin:password@127.0.0.1:30672` · management UI `http://localhost:31672` | `rabbitmq/.env` |
| PostgreSQL | `postgres://postgres:postgres@127.0.0.1:30432/postgres` | `postgres/.env` |
| Zitadel | console `http://localhost:30080` (admin `zitadel-admin`, pw in `zitadel/.env`) | `zitadel/.env` |
| otel-lgtm | Grafana `http://localhost:30000` (anonymous admin) · OTLP/HTTP `http://127.0.0.1:30318` | — (dev, no creds) |

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
