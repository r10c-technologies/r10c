#!/usr/bin/env bash
# Make the local dev datastores usable, healing whatever rung of the ladder is
# broken — and nothing more. Wired as the `ensure-infra` nx target that every
# backend `dev` depends on, so it runs 3-4 times per app boot: the healthy path
# must stay cheap (a handful of TCP probes, no kubectl, no rollout waits).
#
#   L0 tooling      minikube/kubectl/nc present          (not healable — reports)
#   L1 cluster      minikube Running                     -> minikube start --ports
#   L1b kubecontext kubeconfig points at the apiserver   -> minikube update-context
#   L2 port mapping NodePorts published to 127.0.0.1     (not healable — reset --hard)
#   L3 workloads    namespace + deployments reconciled   -> apply.sh
#   L4 rollout      each deployment has a Ready replica  -> restart the pod once
#   L5 probes       TCP + protocol handshake             -> back to L4
#   L6 hosted login v2 login container up on :30081      -> secret + apply -k
#   L7 zitadel seed instance has project/app/actions/policy/SMTP -> zitadel-seed.mjs
#
# Healing here is destructive nowhere. When the ladder cannot fix something it
# exits non-zero naming the exact command that can.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

# `R10C_INFRA=reset pnpm nx run <app>:dev` routes the whole dependency graph
# through a reset, for the nx-native path that has no root script.
if [[ "${R10C_INFRA:-}" == "reset" ]]; then
  exec bash "$DIR/reset.sh" --yes
fi

ROLLOUT_TIMEOUT="${INFRA_ROLLOUT_TIMEOUT:-180s}"
PROBE_ATTEMPTS="${INFRA_PROBE_ATTEMPTS:-45}"

reset_hint() {
  echo "  pnpm run back-office:dev:reset            # recreate datastores (wipes local data)" >&2
  echo "  bash infra/local/reset.sh --hard       # also recreates the minikube cluster" >&2
}

# L5, with patience: a rollout reports Ready a moment before the socket answers.
wait_for_probes() {
  local i
  for (( i = 0; i < PROBE_ATTEMPTS; i++ )); do
    all_probes_green && return 0
    sleep 2
  done
  return 1
}

# ---------------------------------------------------------------- fast path
# The common case: everything is already up. No lock, no kubectl, ~0.2s.
# `zitadel_seeded` is a file test and `login_ready` one local HTTP call, so
# adding L6 and L7 to this question costs almost nothing — and leaving the login
# out would let the fast path green-light a fleet whose sign-in button 404s.
if all_probes_green && login_ready && zitadel_seeded; then
  log_ok "local infra healthy ($(probed_labels))"
  exit 0
fi

require_tools || exit 1
acquire_heal_lock || exit 1

# Someone else may have healed while we queued on the lock.
if all_probes_green && login_ready && zitadel_seeded; then
  log_ok "local infra healthy (healed by a parallel task)"
  exit 0
fi

# ---------------------------------------------------------------- L1 cluster
state="$(minikube_state)"
case "$state" in
  Running) ;;
  Drifted)
    # The cluster is up and its NodePorts are published; only the local context
    # is stale (Docker Desktop restarted and moved the apiserver's host port).
    # Rewriting kubeconfig takes milliseconds, so try it before anything that
    # touches the cluster itself.
    log_heal "minikube: kubeconfig points at a stale apiserver -> updating context"
    fix_kubeconfig
    if ! kubectl get nodes >/dev/null 2>&1; then
      log_heal "minikube: context updated but the API server is still down -> starting"
      minikube start --ports "$MINIKUBE_PORTS"
    fi
    ;;
  Stopped)
    log_heal "minikube: Stopped -> starting"
    minikube start --ports "$MINIKUBE_PORTS"
    ;;
  *)
    log_heal "minikube: no cluster -> creating"
    start_minikube
    ;;
esac

if ! kubectl get nodes >/dev/null 2>&1; then
  # Last resort before giving up: the context can also drift while the ladder is
  # mid-heal, and a wrong endpoint looks exactly like a dead apiserver.
  fix_kubeconfig
fi

if ! kubectl get nodes >/dev/null 2>&1; then
  log_err "minikube is Running but the API server is not answering."
  echo "  minikube update-context                  # if kubectl points at a stale port" >&2
  echo "  minikube logs --file=/tmp/minikube.log   # then inspect" >&2
  reset_hint
  exit 1
fi

# ---------------------------------------------------------------- L2 mapping
# Cheap, driver-specific pre-check. Catches a cluster created by a plain
# `minikube start` before we spend three minutes waiting on rollouts.
missing="$(missing_host_ports)"
if [[ -n "$missing" ]]; then
  log_err "NodePorts not published by the minikube container:$missing"
  echo "  The cluster was created without --ports, so nothing reaches 127.0.0.1." >&2
  echo "  Only fixable by recreating the cluster:" >&2
  reset_hint
  exit 1
fi

# ---------------------------------------------------------------- L3 workloads
# Reconcile unconditionally, not just when a deployment is missing: `kubectl
# apply -k` is idempotent, and "the deployment exists" says nothing about it
# matching the manifests in git. A committed change — a readinessProbe, an image
# bump — would otherwise never reach a cluster that already had the old object,
# so the ladder would keep healing a workload the repo no longer describes.
# Only ever reached off the fast path, so the healthy boot pays nothing.
log_heal "reconciling workloads with the manifests"
bash "$DIR/apply.sh"

# ---------------------------------------------------------------- L4 rollout
restarted=0
for spec in "${PORT_SPECS[@]}"; do
  deploy="$(spec_deploy "$spec")"
  deploy_ready "$deploy" && continue

  reason="$(deploy_reason "$deploy")"
  log_heal "$deploy: not Ready${reason:+ ($reason)} -> waiting for rollout"

  if kubectl -n "$NS" rollout status "deploy/$deploy" --timeout="$ROLLOUT_TIMEOUT" >/dev/null 2>&1; then
    continue
  fi

  # One restart, and only one: a wedged pod (CrashLoopBackOff after a hard kill,
  # a stale lock in a data dir) usually comes back clean. A second failure means
  # the data is bad, which is reset's job, not ensure's.
  log_heal "$deploy: rollout timed out -> restarting pod once"
  kubectl -n "$NS" delete pod -l "app=$deploy" --ignore-not-found >/dev/null 2>&1 || true
  restarted=1
  if ! kubectl -n "$NS" rollout status "deploy/$deploy" --timeout="$ROLLOUT_TIMEOUT" >/dev/null 2>&1; then
    log_err "$deploy did not become Ready after a restart."
    kubectl -n "$NS" get pods -l "app=$deploy" 2>/dev/null || true
    echo "  kubectl -n $NS logs -l app=$deploy --tail=50" >&2
    reset_hint
    exit 1
  fi
done
[[ "$restarted" -eq 1 ]] && log "restarted pods are Ready"

# ---------------------------------------------------------------- L5 probes
if ! wait_for_probes; then
  # Every deployment Ready but the sockets stay shut: the pods are fine and the
  # host cannot reach them. On non-docker drivers this is how port-mapping drift
  # surfaces, since L2 could not answer directly.
  if all_deploys_ready; then
    log_err "all deployments are Ready but their NodePorts are unreachable from 127.0.0.1."
    echo "  The cluster is almost certainly missing its --ports mapping." >&2
    reset_hint
    exit 1
  fi

  log_err "datastores did not become reachable in time."
  for spec in "${PORT_SPECS[@]}"; do
    label="$(spec_label "$spec")"; port="$(spec_port "$spec")"
    probe_datastore "$label" "$port" || echo "  down: $label (:$port)" >&2
  done
  kubectl -n "$NS" get pods 2>/dev/null || true
  reset_hint
  exit 1
fi

# ---------------------------------------------------------------- L6 hosted login
# After L5 because the token it mounts is minted by the core, and before L7
# because L7 is what points the instance at it.
if ! ensure_login; then
  reset_hint
  exit 1
fi

# ---------------------------------------------------------------- L7 zitadel seed
# Runs only once per instance revision, and only after L5: the seed talks to
# Zitadel's API, so it needs the instance actually serving rather than merely
# rolled out.
if ! seed_zitadel; then
  reset_hint
  exit 1
fi

log_ok "local infra healthy ($(probed_labels))"
exit 0
