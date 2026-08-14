# Local infrastructure (`infra/local`)

Local Kubernetes platform for the marketplace fleet, running on Minikube:
**MongoDB**, **Redis**, **RabbitMQ** (transaction event bus), **PostgreSQL**,
**Zitadel** (identity), **Mailpit** (dev SMTP) and **otel-lgtm** (Grafana stack).
Everything lives in the `marketplace-local-infra` namespace.

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

| Rung            | Check                               | Heal                                   |
| --------------- | ----------------------------------- | -------------------------------------- |
| L0 tooling      | `minikube` / `kubectl` / `nc`       | — reports the `brew install` line      |
| L1 cluster      | minikube `Running`                  | `minikube start --ports …`             |
| L1b kubecontext | kubeconfig points at the apiserver  | `minikube update-context` (~2s)        |
| L2 portmap      | NodePorts published to `127.0.0.1`  | — needs `reset.sh --hard`              |
| L3 workloads    | deployments match the manifests     | `apply.sh` (always, off the fast path) |
| L4 rollout      | each deployment has a Ready replica | delete the pod once, re-wait           |
| L5 probes       | TCP + protocol handshake            | back to L4                             |
| L6 hosted login | v2 login answering on `:30081`      | secret from the PAT + `apply -k`       |
| L7 zitadel seed | instance seeded at the current rev  | `tools/zitadel-seed.mjs`               |

Two things it does **not** do, on purpose: it never deletes data, and it never
recreates the cluster. Both are `reset.sh`'s job, and it exits naming the exact
command when it hits one of them.

> **A socket that answers proves nothing.** docker-proxy and kube-proxy both
> keep a published NodePort accepting connections when nothing serves behind it
> — after the pod is gone (`kubectl -n marketplace-local-infra delete deploy
mongodb` and the port stays open) and equally _before_ the datastore's own
> listener exists (`kubectl -n marketplace-local-infra rollout restart
deploy/rabbitmq`, then `nc -z 127.0.0.1 30672` succeeds two seconds later
> while AMQP still answers "socket closed abruptly during opening handshake").
> That second half is why **every deployment declares a protocol-level
> `readinessProbe`** — AMQP for rabbit, `pg_isready`, an authenticated redis
> `PING`, a mongo `ping`, the OTLP port for otel-lgtm. Without one,
> `readyReplicas` means "the container started", the ladder green-lights a fleet
> whose datastores are still booting, and a service that dials RabbitMQ at boot
> dies with exit code 1.

> **kubeconfig drift is its own rung.** Docker Desktop republishes the apiserver
> on a new host port every restart, so kubeconfig keeps pointing at the old one
> (`minikube status` says `Kubeconfig: Misconfigured`) and every `kubectl` call
> fails against a cluster that is otherwise healthy. `update-context` fixes it in
> milliseconds, so L1b is tried before anything that touches the cluster.

Each PVC-backed datastore uses `strategy: Recreate`: they share one
ReadWriteOnce volume, and a rolling update starts the replacement while the old
pod still holds the data dir's lock (`DBPathInUse` for mongo). Since L3
reconciles on every heal, a manifest edit would otherwise wedge the datastore it
was meant to improve.

Parallel `ensure-infra` tasks serialise on `infra/local/.heal.lock`
(git-ignored): the first heals, the rest wait and re-probe. The lock records its
owner's pid — Ctrl-C'ing an app leaves the directory behind, and a lock whose
owner is gone is broken immediately rather than after the ten-minute age
threshold (ten silent minutes is indistinguishable from a hang).

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

Zitadel is **load-bearing**, not opt-in: auth-service authenticates against it
and can sign nobody in without it ([ADR 0016](../../docs/adr/0016-zitadel-authenticates-r10c-authorizes.md)).
It costs a Postgres rollout wait plus ~1min of self-init on a first apply, which
is why the ladder's L7 rung caches what it produced.

**It is two containers.** The core image serves the API and the console; the
hosted login is a separate Next.js app (`infra/local/zitadel-login`) on its own
NodePort **30081**, and Zitadel redirects the browser there. Without it every
sign-in answers 404 while `/debug/ready` stays green, which is why it gets a rung
and a probe rather than being trusted to come up
([ADR 0018](../../docs/adr/0018-the-hosted-login-is-a-second-container.md)).

**Their two image tags are one tag.** The login is a client of the core's session
API, so bumping one manifest and not the other is a version skew across an
internal API — and its symptom is a sign-in screen that renders and then fails
mid-flow, which no probe can see. `pnpm nx test @r10c/docs-check` reads both
literals and fails the build when they disagree, so a bump means editing
`zitadel/deployment.yaml` and `zitadel-login/deployment.yaml` together.

**The L6 rung.** After the probes go green, `ensure.sh` extracts the
`IAM_LOGIN_CLIENT` token Zitadel minted at first init
(`infra/local/zitadel/.login-client.pat`), applies it as `zitadel-login-secret`,
and brings the login workload up. It runs _before_ the seed on purpose: the seed
is what points the instance at the login, and flipping that switch towards an
address serving nothing is the failure this rung exists to prevent.

**The L7 rung.** `ensure.sh` then extracts the seed's own machine token
(`infra/local/zitadel/.pat`) and runs `tools/zitadel-seed.mjs`, which is
idempotent and ensures the `r10c` project, a **public** OIDC app (PKCE, no
secret), login v2 required and pointed at `:30081`, an instance label policy
carrying the r10c palette (aurora light / midnight dark — the login reads it
through `GET /v2/settings/branding`), a login policy with self-registration and
OTP available but **not forced**, SMTP pointed at Mailpit,
and a Google IdP _only when_ `infra/local/zitadel/.env` carries credentials. It
writes the per-instance client id and token to
`infra/local/zitadel/.generated.env` (gitignored), which config-service's seed
reads.

**Checking the branding takes a real sign-in, not `:30081` on its own.** Opening
`http://localhost:30081/ui/v2/login/loginname` directly gives the login no
request context, and it falls back to its built-in default theme — which is
Zitadel's palette, so a correctly branded instance looks exactly like an
unbranded one. Measured: restarting the login pod does not change it, because it
is not a cache. Go through `/oauth/v2/authorize` (or just start
`back-office-app` and click sign in) so the URL carries a `requestId`; then the
page is on `#f7f9fc` with `#3b6ff5` controls and the light/dark switcher is gone,
`THEME_MODE_LIGHT` having settled the question. The API-level check that needs no
browser is `GET /v2/settings/branding` with the seed's PAT.

All three files are deleted by `reset.sh`, which is deliberate: the instance and
the configuration naming it are recreated together, so a stale client id can
never outlive the instance it pointed at.

> **Both machine tokens come from first-instance init.** A `FIRSTINSTANCE_*` key
> fires only when the instance is created, so an instance older than one of them
> never grows the user it describes. There is no in-place upgrade — the fix is
> `pnpm run <app>:dev:reset`, and the ladder says so when the token is missing.

### Status

```bash
pnpm run dev-infra:doctor                           # ladder view + the fix
kubectl get pods,pvc,svc -n marketplace-local-infra # raw
```

---

## Connect from a local app

No port-forward needed — the cluster is started with `--ports`, so each
NodePort is reachable on `127.0.0.1`.

| Platform      | URL / DSN                                                                               | Creds source      |
| ------------- | --------------------------------------------------------------------------------------- | ----------------- |
| MongoDB       | `mongodb://admin:password@127.0.0.1:30017`                                              | `mongodb/.env`    |
| Redis         | `redis://:localdev@127.0.0.1:30379` (`redis-cli -p 30379 -a localdev ping`)             | `redis/.env`      |
| RabbitMQ      | `amqp://admin:password@127.0.0.1:30672` · management UI `http://localhost:31672`        | `rabbitmq/.env`   |
| PostgreSQL    | `postgres://postgres:postgres@127.0.0.1:30432/postgres`                                 | `postgres/.env`   |
| Zitadel       | console `http://localhost:30080` (admin `zitadel-admin`, pw in `zitadel/.env`)          | `zitadel/.env`    |
| Zitadel login | hosted login v2 `http://localhost:30081/ui/v2/login` (the core redirects here)          | — (dev, no creds) |
| Mailpit       | web UI `http://localhost:30826` · SMTP `127.0.0.1:30825` (no auth)                      | — (dev, no creds) |
| otel-lgtm     | Grafana `http://localhost:30000` (anonymous admin) · OTLP/HTTP `http://127.0.0.1:30318` | — (dev, no creds) |

---

## Per-platform manifests

```
infra/local/
  00-namespace.yaml
  apply.sh  teardown.sh
  mongodb/  redis/  rabbitmq/  postgres/   # each: kustomization + manifests + .env.example
  zitadel/  mailpit/  otel-lgtm/
  zitadel-login/                           # applied by the L6 rung, not by apply.sh
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
