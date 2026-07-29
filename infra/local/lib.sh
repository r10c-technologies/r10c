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
)

# Kustomize folders applied by apply.sh, in dependency order. Zitadel is opt-in
# (`INFRA_INCLUDE_ZITADEL=1`): nothing in the fleet authenticates against it
# today, and it costs a Postgres rollout wait plus ~1min of self-init.
PLATFORMS=(mongodb redis rabbitmq postgres otel-lgtm)

# The full host->node mapping minikube must be created with. Every NodePort the
# manifests expose, including the ones the health ladder does not probe
# (rabbitmq management 31672, zitadel 30080, grafana 30000, OTLP/gRPC 30317).
MINIKUBE_PORTS="30017:30017,30379:30379,30672:30672,31672:31672,30432:30432,30080:30080,30000:30000,30317:30317,30318:30318"

# Ports that must be published by the VM/container for the fleet to work at all.
REQUIRED_HOST_PORTS=(30017 30379 30672 30432 30318)

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
  esac
  return 0
}

# minikube lifecycle state, normalised to Running / Stopped / Nonexistent.
minikube_state() {
  local out
  out="$(minikube status --format '{{.Host}}' 2>/dev/null || true)"
  case "$out" in
    Running) echo Running ;;
    Stopped) echo Stopped ;;
    *)       echo Nonexistent ;;
  esac
}

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

# The fast-path question. Deployment readiness is part of it on purpose: with
# the docker driver, docker-proxy keeps a published NodePort accepting TCP
# connections after the pod behind it is gone, so a socket that answers proves
# nothing on its own. Deleting the mongodb deployment and re-running ensure.sh
# is the one-line way to reproduce that.
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

# mkdir is the atomic primitive available everywhere; a lock older than
# LOCK_STALE_SECONDS is assumed abandoned (killed nx task) and broken.
acquire_heal_lock() {
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    local age=0
    if [[ -d "$LOCK_DIR" ]]; then
      local mtime now
      mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0)"
      now="$(date +%s)"
      age=$(( now - mtime ))
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
