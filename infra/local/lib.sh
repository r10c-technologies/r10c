#!/usr/bin/env bash
# Shared vocabulary for the local-infra scripts (ensure / reset / doctor / apply).
#
# Sourced, never executed. Everything the scripts need to agree on — the
# namespace, which NodePorts belong to which deployment, the minikube port
# mapping, logging, and the health ladder's individual rungs — lives here so a
# new datastore is added in exactly one place.
#
# Written for bash 3.2 (macOS system bash): no associative arrays, no `mapfile`.

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/../.." && pwd)"
NS=marketplace-local-infra

# One entry per datastore the fleet dials, as `label:nodePort:deployment`.
# The health ladder walks this list; adding a datastore means adding a line
# (plus its kustomize folder to PLATFORMS below).
PORT_SPECS=(
  "mongo:30017:mongodb"
  "redis:30379:redis"
  "rabbitmq:30672:rabbitmq"
  "postgres:30432:postgres"
  "otel:30318:otel-lgtm"
  "zitadel:30080:zitadel"
  "mailpit:30825:mailpit"
)

# Kustomize folders applied by apply.sh, in dependency order. Zitadel goes last
# because it needs Postgres to exist before its own init runs.
#
# `zitadel-login` is deliberately absent: it mounts a Secret holding a PAT that
# does not exist until Zitadel has created its first instance, so it is applied
# by its own rung (L6) rather than at L3 with everything else. See
# LOGIN_PLATFORM below.
PLATFORMS=(mongodb redis rabbitmq postgres otel-lgtm mailpit zitadel)

# The v2 hosted login. A separate Next.js container that the core image does not
# serve, so without it every authorization redirect answers 404 while
# `/debug/ready` stays green — which is why it gets a rung and a probe of its
# own rather than being trusted to come up.
LOGIN_PLATFORM=zitadel-login
LOGIN_DEPLOYMENT=zitadel-login
LOGIN_NODEPORT=30081
LOGIN_SECRET=zitadel-login-secret

# The full host->node mapping minikube must be created with. Every NodePort the
# manifests expose, including the ones the health ladder does not probe
# (rabbitmq management 31672, grafana 30000, OTLP/gRPC 30317, mailpit's web UI
# 30826).
MINIKUBE_PORTS="30017:30017,30379:30379,30672:30672,31672:31672,30432:30432,30080:30080,30081:30081,30000:30000,30317:30317,30318:30318,30825:30825,30826:30826"

# Ports that must be published by the VM/container for the fleet to work at all.
# Zitadel is in this list now that it authenticates every sign-in: without it
# nobody can obtain a session, which is not a degraded fleet but a stopped one.
# 30081 is the hosted login and carries exactly the same weight — the core
# redirects the browser there and serves nothing on that path itself.
REQUIRED_HOST_PORTS=(30017 30379 30672 30432 30318 30080 30081 30825)

# Written by the L7 seed rung, read by config-service's dev target. None of these
# files are committed: all are regenerated from scratch on every reset, because
# the instance they describe is too.
ZITADEL_PAT_FILE="$INFRA_DIR/zitadel/.pat"
ZITADEL_LOGIN_PAT_FILE="$INFRA_DIR/zitadel/.login-client.pat"
ZITADEL_GENERATED_ENV="$INFRA_DIR/zitadel/.generated.env"

# Serializes healing when several `ensure-infra` tasks race (a single app `dev`
# fans out to 3-4 of them). Whoever wins heals; the rest wait and re-probe.
LOCK_DIR="$INFRA_DIR/.heal.lock"
LOCK_STALE_SECONDS=600

if [[ -t 1 ]]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BOLD=''; C_OFF=''
fi

log()      { echo "${C_DIM}==>${C_OFF} $*"; }
log_heal() { echo "${C_YELLOW}==> heal:${C_OFF} $*"; }
log_ok()   { echo "${C_GREEN}==>${C_OFF} $*"; }
log_err()  { echo "${C_RED}ERROR:${C_OFF} $*" >&2; }

spec_label()  { echo "${1%%:*}"; }
spec_port()   { local r="${1#*:}"; echo "${r%%:*}"; }
spec_deploy() { echo "${1##*:}"; }

# --- rung probes -------------------------------------------------------------

# TCP reachability. Necessary but NOT sufficient: with the docker driver the
# published port can accept a connection while nothing serves behind it, which
# is exactly how a crashlooping datastore used to read as healthy.
#
# `-G` (connect timeout) is macOS-only; GNU/OpenBSD netcat takes `-w` alone.
# Resolved once at source time so the probe never hangs on a black-holed port.
if nc -z -G 1 -w 1 127.0.0.1 1 2>&1 | grep -qiE 'illegal option|invalid option|usage:'; then
  NC_OPTS=(-z -w 2)
else
  NC_OPTS=(-z -G 2 -w 2)
fi
port_open() { nc "${NC_OPTS[@]}" 127.0.0.1 "$1" >/dev/null 2>&1; }

has() { command -v "$1" >/dev/null 2>&1; }

# Protocol-level probe when the client is installed locally, TCP otherwise.
# Optional host tooling: never a hard requirement, only a sharper signal.
probe_datastore() {
  local label="$1" port="$2"
  port_open "$port" || return 1
  case "$label" in
    postgres) has pg_isready && { pg_isready -q -h 127.0.0.1 -p "$port" -t 2 >/dev/null 2>&1 || return 1; } ;;
    redis)    has redis-cli  && { redis-cli -h 127.0.0.1 -p "$port" --no-auth-warning ping 2>/dev/null | grep -qE 'PONG|NOAUTH' || return 1; } ;;
    mongo)    has mongosh    && { mongosh "mongodb://127.0.0.1:$port" --quiet --eval 'db.adminCommand({ping:1})' >/dev/null 2>&1 || return 1; } ;;
    # Zitadel spends ~1min self-initialising behind an open socket, so TCP is
    # even less of a signal here than elsewhere: it answers from the moment the
    # container starts and long before the instance can serve a login.
    zitadel)  has curl && { curl -fsS --max-time 2 "http://127.0.0.1:$port/debug/ready" >/dev/null 2>&1 || return 1; } ;;
    # The SMTP port is what Zitadel dials; the UI port is what a human reads.
    mailpit)  has curl && { curl -fsS --max-time 2 "http://127.0.0.1:30826/readyz" >/dev/null 2>&1 || return 1; } ;;
  esac
  return 0
}

# The labels the ladder actually probes, for the "healthy" line. Derived rather
# than written out, so adding a PORT_SPECS entry cannot leave a stale list.
probed_labels() {
  local spec out=""
  for spec in "${PORT_SPECS[@]}"; do out="$out $(spec_label "$spec")"; done
  echo "${out# }"
}

# Bumped in the same commit as any change to `tools/zitadel-seed.mjs` that adds
# or alters a setting on the instance. Rev 1 → 2 added the OIDC app's
# `backChannelLogoutUri`; rev 2 → 3 turned the v2 hosted login on and pointed
# the instance at its base URI; rev 3 → 4 added the Actions v2 target and the
# three user-lifecycle executions that revoke r10c sessions when a user is
# deactivated at the provider; rev 4 → 5 moved the OIDC redirect URI onto
# back-office-app when auth-app merged into it; rev 5 → 6 gave the instance a
# label policy, which is what the hosted login renders in.
ZITADEL_SEED_REVISION=6

# L7: has the Zitadel instance been given its project, app, policies, branding
# and SMTP — by the version of the seed that is checked in right now?
#
# Still a file read, so the ladder's fast path pays nothing to ask. But it is a
# *cache key*, not a "has this ever run" flag: the guard used to be `-s` alone,
# which meant a seed that gained a setting never reached any machine that was
# already seeded. The fast path in `ensure.sh` exits before `seed_zitadel` is
# even called, so the stale instance stayed stale and reported green. Stamping
# the revision into the file is what makes a seed change reach everyone on their
# next boot, without a reset and without walking the ladder.
zitadel_seeded() {
  [[ -s "$ZITADEL_GENERATED_ENV" ]] &&
    grep -qx "ZITADEL_SEED_REVISION=$ZITADEL_SEED_REVISION" \
      "$ZITADEL_GENERATED_ENV"
}

# Copy one of the machine tokens Zitadel minted at first init out of the pod.
#
# Zitadel writes each exactly once, to an emptyDir, so a pod restart loses the
# file while the instance itself survives in Postgres. That is why the host copy
# is authoritative once taken: we only ever read from the pod when we have no
# copy of our own, and if both are gone the instance is unreachable to us and
# the only honest answer is a reset.
#
# Args: <in-pod filename under /machinekey> <host destination> <what it is for>
extract_machine_pat() {
  local pod_file="$1" dest="$2" what="$3" pat
  [[ -s "$dest" ]] && return 0
  # `-c pat-reader`: the zitadel container is distroless and has no `cat`.
  pat="$(kubectl -n "$NS" exec "deploy/zitadel" -c pat-reader -- cat "/machinekey/$pod_file" 2>/dev/null || true)"
  if [[ -z "$pat" ]]; then
    log_err "Zitadel is up but its $what token is gone."
    echo "  Either the pod restarted after first init, or this instance predates" >&2
    echo "  the setting that mints the token — a FIRSTINSTANCE_* key only ever" >&2
    echo "  fires when the instance is created. Either way, recreate both:" >&2
    return 1
  fi
  printf '%s' "$pat" > "$dest"
  chmod 600 "$dest" 2>/dev/null || true
  return 0
}

extract_zitadel_pat() {
  extract_machine_pat seed.pat "$ZITADEL_PAT_FILE" seed
}

# L6: hand the login container the IAM_LOGIN_CLIENT token it authenticates to
# Zitadel's session API with. Applied imperatively rather than through kustomize
# because the value does not exist until the core's first init has run.
#
# `create --dry-run | apply` is the idempotent form, which matches the rung's
# posture everywhere else: L3 re-applies the manifests on every heal because a
# resource existing says nothing about it matching what is checked in.
ensure_login_secret() {
  extract_machine_pat login-client.pat "$ZITADEL_LOGIN_PAT_FILE" "login client" || return 1
  kubectl -n "$NS" create secret generic "$LOGIN_SECRET" \
    --from-file="login-client.pat=$ZITADEL_LOGIN_PAT_FILE" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
}

# L6's probe. `/ui/v2/login/healthy` is served without touching the Zitadel API,
# so it answers the one question this rung owns: is the login itself up.
login_ready() {
  port_open "$LOGIN_NODEPORT" || return 1
  has curl || return 0
  curl -fsS --max-time 2 "http://127.0.0.1:$LOGIN_NODEPORT/ui/v2/login/healthy" >/dev/null 2>&1
}

# L6 proper. Deliberately ordered BEFORE the seed: the seed is what turns login
# v2 on, and flipping that switch while nothing serves `/ui/v2/login` is the
# green-probes-404-sign-in failure this whole rung exists to prevent.
ensure_login() {
  local timeout="${INFRA_ROLLOUT_TIMEOUT:-180s}" attempts="${INFRA_PROBE_ATTEMPTS:-45}" i
  ensure_login_secret || return 1
  log_heal "zitadel-login: reconciling the hosted login workload"
  kubectl apply -k "$INFRA_DIR/$LOGIN_PLATFORM" >/dev/null || return 1
  kubectl -n "$NS" rollout status "deploy/$LOGIN_DEPLOYMENT" --timeout="$timeout" >/dev/null 2>&1 || {
    log_err "$LOGIN_DEPLOYMENT did not become Ready."
    kubectl -n "$NS" get pods -l "app=$LOGIN_DEPLOYMENT" 2>/dev/null || true
    echo "  kubectl -n $NS logs -l app=$LOGIN_DEPLOYMENT --tail=50" >&2
    return 1
  }
  for (( i = 0; i < attempts; i++ )); do
    login_ready && return 0
    sleep 2
  done
  log_err "the hosted login is Ready but :$LOGIN_NODEPORT does not answer /ui/v2/login/healthy."
  return 1
}

# L7 proper: give the instance everything the fleet expects to find in it.
# Idempotent — every step searches before it creates, and the OIDC app is
# reconciled rather than skipped — so re-running against a seeded instance is
# safe and is exactly what a revision bump asks for.
seed_zitadel() {
  zitadel_seeded && return 0
  extract_zitadel_pat || return 1
  log_heal "zitadel: seeding project, OIDC app, login v2, branding, actions, login policy and SMTP"
  ZITADEL_PAT_FILE="$ZITADEL_PAT_FILE" \
  ZITADEL_GENERATED_ENV="$ZITADEL_GENERATED_ENV" \
  ZITADEL_ISSUER="http://localhost:30080" \
  ZITADEL_SEED_REVISION="$ZITADEL_SEED_REVISION" \
    node "$REPO_ROOT/tools/zitadel-seed.mjs"
}

# minikube lifecycle state, normalised to Running / Drifted / Stopped /
# Nonexistent.
#
# `Drifted` is its own state because it is neither of the other three and heals
# differently: Docker Desktop republishes the apiserver on a fresh host port
# every time it restarts, so kubeconfig keeps pointing at the old one
# (`kubeconfig endpoint: got: 127.0.0.1:49704, want: 127.0.0.1:52057`) and every
# kubectl call fails against a cluster that is otherwise fine. Reading only
# `{{.Host}}` used to report that as `Nonexistent`, which sent the ladder into a
# two-minute `minikube start` — and told the operator there was no cluster.
minikube_state() {
  local json host kubeconfig apiserver
  json="$(minikube status -o json 2>/dev/null || true)"
  if [[ -z "$json" ]]; then
    # No JSON at all: either no cluster, or a status too broken to parse. Fall
    # back to the plain format so a Stopped cluster is still recognised.
    case "$(minikube status --format '{{.Host}}' 2>/dev/null || true)" in
      Running) echo Running ;;
      Stopped) echo Stopped ;;
      *)       echo Nonexistent ;;
    esac
    return 0
  fi
  host="$(json_field "$json" Host)"
  kubeconfig="$(json_field "$json" Kubeconfig)"
  apiserver="$(json_field "$json" APIServer)"
  case "$host" in
    Running)
      if [[ "$kubeconfig" == "Misconfigured" || "$apiserver" != "Running" ]]; then
        echo Drifted
      else
        echo Running
      fi
      ;;
    Stopped) echo Stopped ;;
    *)       echo Nonexistent ;;
  esac
}

# One flat field out of minikube's status JSON, without requiring `jq` (which is
# not in the L0 tool list).
json_field() {
  echo "$1" | tr ',{}' '\n' | grep -m1 "\"$2\"" | cut -d'"' -f4
}

# Point kubeconfig back at the apiserver's current host port. Instant, and
# destroys nothing: it only rewrites the local context.
fix_kubeconfig() { minikube update-context >/dev/null 2>&1; }

kube_reachable() { kubectl -n "$NS" get ns "$NS" >/dev/null 2>&1 || kubectl get ns "$NS" >/dev/null 2>&1; }

deploy_ready() {
  local name="$1" ready
  ready="$(kubectl -n "$NS" get deploy "$name" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  [[ "${ready:-0}" -ge 1 ]]
}

deploy_exists() { kubectl -n "$NS" get deploy "$1" >/dev/null 2>&1; }

# Why a deployment is not Ready, for the operator. Best-effort, never fails.
deploy_reason() {
  kubectl -n "$NS" get pods -l "app=$1" \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[*].state.waiting.reason}{" "}{end}' 2>/dev/null || true
}

all_datastores_reachable() {
  local spec
  for spec in "${PORT_SPECS[@]}"; do
    probe_datastore "$(spec_label "$spec")" "$(spec_port "$spec")" || return 1
  done
  return 0
}

# Readiness for every probed deployment in ONE API call (~35ms), so the
# fast path can afford to ask the cluster on every invocation.
all_deploys_ready() {
  local snapshot spec name
  snapshot="$(kubectl -n "$NS" get deploy \
    -o jsonpath='{range .items[*]}{.metadata.name}={.status.readyReplicas}{"\n"}{end}' 2>/dev/null)" || return 1
  [[ -n "$snapshot" ]] || return 1
  for spec in "${PORT_SPECS[@]}"; do
    name="$(spec_deploy "$spec")"
    echo "$snapshot" | grep -qE "^$name=[1-9]" || return 1
  done
  return 0
}

# The fast-path question. Deployment readiness is part of it on purpose, and it
# carries most of the weight: with the docker driver, docker-proxy and kube-proxy
# both keep a published NodePort accepting TCP connections when nothing serves
# behind it — after the pod is gone, and equally *before* the datastore's own
# listener exists. So a socket that answers proves nothing on its own, which is
# why every deployment in `infra/local/*` declares a protocol-level
# `readinessProbe` (AMQP for rabbit, `pg_isready`, an authenticated redis PING,
# a mongo `ping`, Zitadel's `/debug/ready`). Without one, `readyReplicas` means only "the container
# started", and this function green-lights a fleet whose services will then die
# dialling a datastore that is still booting.
# Deleting the mongodb deployment and re-running ensure.sh reproduces the
# gone-pod half; `kubectl -n … rollout restart deploy/rabbitmq` reproduces the
# still-booting half.
all_probes_green() { all_datastores_reachable && all_deploys_ready; }

# Host port mapping drift: a cluster created by a plain `minikube start` has no
# --ports mapping, so NodePorts never reach 127.0.0.1 no matter how healthy the
# pods are. Only answerable directly on the docker driver; on other drivers the
# ladder infers it (pods Ready + ports shut) instead.
missing_host_ports() {
  local driver missing="" p
  driver="$(minikube profile list -o json 2>/dev/null | tr ',' '\n' | grep -m1 '"Driver"' | cut -d'"' -f4 || true)"
  [[ "$driver" == "docker" ]] || return 0
  has docker || return 0
  local published
  published="$(docker port minikube 2>/dev/null || true)"
  [[ -n "$published" ]] || return 0
  for p in "${REQUIRED_HOST_PORTS[@]}"; do
    echo "$published" | grep -q "^$p/tcp" || missing="$missing $p"
  done
  echo "${missing# }"
}

# --- lock --------------------------------------------------------------------

# mkdir is the atomic primitive available everywhere.
#
# The lock records its owner's pid, and a lock whose owner is gone is stale
# *immediately* — age alone was not enough. Ctrl-C'ing an app leaves the lock
# behind, so the next boot used to sit in silence for the full
# LOCK_STALE_SECONDS (ten minutes) before breaking a lock nobody held. That is
# indistinguishable from a hang, and it is the most common way a dev boot
# "does nothing".
acquire_heal_lock() {
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    local age=0 owner=""
    if [[ -d "$LOCK_DIR" ]]; then
      local mtime now
      mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0)"
      now="$(date +%s)"
      age=$(( now - mtime ))
      owner="$(cat "$LOCK_DIR/owner.pid" 2>/dev/null || true)"
    fi
    # An owner that is not running took its heal with it. `kill -0` is the
    # portable liveness check; a lock with no pid file at all is from an older
    # revision and falls through to the age rule.
    if [[ -n "$owner" ]] && ! kill -0 "$owner" 2>/dev/null; then
      log_heal "breaking abandoned infra lock (owner pid $owner is gone)"
      rm -rf "$LOCK_DIR"
      continue
    fi
    if [[ "$age" -gt "$LOCK_STALE_SECONDS" ]]; then
      log_heal "breaking stale infra lock (${age}s old)"
      rm -rf "$LOCK_DIR"
      continue
    fi
    [[ "$waited" -eq 0 ]] && log "another task is healing local infra — waiting"
    sleep 2
    waited=$(( waited + 2 ))
    if [[ "$waited" -ge 600 ]]; then
      log_err "timed out waiting for the infra heal lock ($LOCK_DIR)"
      return 1
    fi
  done
  echo "$$" > "$LOCK_DIR/owner.pid" 2>/dev/null || true
  trap release_heal_lock EXIT INT TERM
  return 0
}

release_heal_lock() { rm -rf "$LOCK_DIR"; }

# --- preflight ---------------------------------------------------------------

require_tools() {
  local missing=""
  local t
  for t in minikube kubectl nc; do
    has "$t" || missing="$missing $t"
  done
  if [[ -n "$missing" ]]; then
    log_err "missing required tool(s):$missing"
    echo "  brew install minikube kubernetes-cli" >&2
    return 1
  fi
  return 0
}

start_minikube() {
  log_heal "minikube: starting with NodePort mapping"
  minikube start --ports "$MINIKUBE_PORTS"
}
