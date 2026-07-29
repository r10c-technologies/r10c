#!/usr/bin/env bash
# Make the local dev datastores usable, healing whatever rung of the ladder is
# broken — and nothing more. Wired as the `ensure-infra` nx target that every
# backend `dev` depends on, so it runs 3-4 times per app boot: the healthy path
# must stay cheap (a handful of TCP probes, no kubectl, no rollout waits).
#
#   L0 tooling      minikube/kubectl/nc present          (not healable — reports)
#   L1 cluster      minikube Running                     -> minikube start --ports
#   L2 port mapping NodePorts published to 127.0.0.1     (not healable — reset --hard)
#   L3 workloads    namespace + deployments exist        -> apply.sh
#   L4 rollout      each deployment has a Ready replica  -> restart the pod once
#   L5 probes       TCP + protocol handshake             -> back to L4
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
  echo "  pnpm run mp-admin:dev:reset            # recreate datastores (wipes local data)" >&2
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
if all_probes_green; then
  log_ok "local infra healthy (mongo redis rabbitmq postgres otel)"
  exit 0
fi

require_tools || exit 1
acquire_heal_lock || exit 1

# Someone else may have healed while we queued on the lock.
if all_probes_green; then
  log_ok "local infra healthy (healed by a parallel task)"
  exit 0
fi

# ---------------------------------------------------------------- L1 cluster
state="$(minikube_state)"
case "$state" in
  Running) ;;
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
  log_err "minikube is Running but the API server is not answering."
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
needs_apply=0
for spec in "${PORT_SPECS[@]}"; do
  deploy_exists "$(spec_deploy "$spec")" || needs_apply=1
done
if [[ "$needs_apply" -eq 1 ]]; then
  log_heal "workloads missing -> applying manifests"
  bash "$DIR/apply.sh"
fi

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
if wait_for_probes; then
  log_ok "local infra healthy (mongo redis rabbitmq postgres otel)"
  exit 0
fi

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
