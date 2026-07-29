#!/usr/bin/env bash
# Recreate the local infrastructure from nothing. This is the heal of last
# resort: it fixes the class of problem `ensure.sh` deliberately refuses to
# touch — bad *data*. Stale Mongo user docs from before a seed changed, drifted
# `configuration` rows in Postgres (the seed is INSERT ... ON CONFLICT DO
# NOTHING, so a wrong value is never corrected in place), a wedged data dir.
#
# It fixes them by throwing the data away and letting service boot rebuild it:
# config-service recreates and re-seeds its table, auth-service reconciles its
# seed identities into an empty Mongo.
#
#   reset.sh            datastores: delete namespace + wipe hostPaths, re-apply
#   reset.sh --hard     the above, plus recreate the minikube cluster itself
#                       (the only fix for a missing --ports mapping)
#   reset.sh --yes      skip the confirmation prompt
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

HARD=0
ASSUME_YES="${INFRA_ASSUME_YES:-0}"
for arg in "$@"; do
  case "$arg" in
    --hard) HARD=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    *) log_err "unknown flag: $arg"; exit 2 ;;
  esac
done

require_tools || exit 1

echo
echo "${C_BOLD}RESET local infrastructure${C_OFF}"
echo "  deletes namespace ${C_BOLD}$NS${C_OFF} (workloads, PVCs, PVs)"
echo "  wipes /data/marketplace-{mongodb,redis,rabbitmq,postgres} inside minikube"
[[ "$HARD" -eq 1 ]] && echo "  ${C_BOLD}--hard${C_OFF}: deletes and recreates the minikube cluster"
echo "  ${C_YELLOW}Local dev data is lost${C_OFF}: users, sessions, catalog docs, config rows."
echo "  All of it is re-seeded on the next service boot."
echo
if [[ "$ASSUME_YES" != "1" ]]; then
  if [[ ! -t 0 ]]; then
    log_err "refusing to reset without a TTY — pass --yes to confirm non-interactively."
    exit 1
  fi
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

acquire_heal_lock || exit 1

# ------------------------------------------------------------------ cluster
if [[ "$HARD" -eq 1 ]]; then
  log_heal "minikube: deleting cluster"
  minikube delete || true
  start_minikube
else
  case "$(minikube_state)" in
    Running) ;;
    Stopped) log_heal "minikube: Stopped -> starting"; minikube start --ports "$MINIKUBE_PORTS" ;;
    *)       log_heal "minikube: no cluster -> creating"; start_minikube ;;
  esac
fi

# --------------------------------------------------------------- datastores
if [[ "$HARD" -eq 0 ]]; then
  log "tearing down workloads"
  bash "$DIR/teardown.sh" >/dev/null 2>&1 || true

  log "deleting namespace $NS"
  kubectl delete ns "$NS" --ignore-not-found --wait --timeout=180s || true

  # PVs are cluster-scoped and `Retain`, so they outlive the namespace and would
  # bind the new PVCs to the old (Released) volumes. Delete them explicitly.
  log "deleting persistent volumes"
  kubectl delete pv mongodb-pv redis-pv rabbitmq-pv postgres-pv --ignore-not-found >/dev/null 2>&1 || true

  # The step a plain teardown skips, and the reason a "reset" used to change
  # nothing: hostPath data survives the PV.
  log "wiping hostPath data inside minikube"
  minikube ssh -- 'sudo rm -rf /data/marketplace-mongodb /data/marketplace-redis /data/marketplace-rabbitmq /data/marketplace-postgres' >/dev/null 2>&1 || true
fi

log "applying manifests"
bash "$DIR/apply.sh"

# ------------------------------------------------------------------ ladder
log "waiting for deployments"
for spec in "${PORT_SPECS[@]}"; do
  deploy="$(spec_deploy "$spec")"
  kubectl -n "$NS" rollout status "deploy/$deploy" --timeout="${INFRA_ROLLOUT_TIMEOUT:-240s}" >/dev/null || {
    log_err "$deploy did not become Ready"
    kubectl -n "$NS" get pods 2>/dev/null || true
    exit 1
  }
done

log "waiting for datastores to answer"
for (( i = 0; i < 60; i++ )); do
  all_probes_green && break
  sleep 2
done
if ! all_probes_green; then
  log_err "datastores are Ready but not reachable from 127.0.0.1."
  if [[ "$HARD" -eq 0 ]]; then
    echo "  The cluster may be missing its --ports mapping. Recreate it:" >&2
    echo "    bash infra/local/reset.sh --hard" >&2
  fi
  exit 1
fi

# --------------------------------------------------------------- app caches
# Same idea one layer up: a reset is worthless if the app then serves a stale
# build against the fresh datastores.
log "clearing nx cache and Next build output"
( cd "$REPO_ROOT" && pnpm nx reset >/dev/null 2>&1 ) || true
rm -rf "$REPO_ROOT"/apps/*/.next

log_ok "reset complete — datastores are empty and will re-seed on service boot"
