#!/usr/bin/env bash
# Bring up the local marketplace infrastructure on the current kube-context
# (expected: minikube). Idempotent — safe to re-run.
#
# Zitadel is opt-in (`INFRA_INCLUDE_ZITADEL=1`): nothing in the fleet
# authenticates against it today (auth-service owns credentials), and applying
# it costs a Postgres rollout wait plus ~1min of self-init on every boot.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

INCLUDE_ZITADEL="${INFRA_INCLUDE_ZITADEL:-0}"

# Ensure each platform has a real .env (copied from its committed example).
ensure_env() {
  local d="$1"
  if [[ -f "$DIR/$d/.env" ]]; then return 0; fi
  if [[ -f "$DIR/$d/.env.example" ]]; then
    cp "$DIR/$d/.env.example" "$DIR/$d/.env"
    echo "  created $d/.env from .env.example"
  fi
}

# Generate a random Zitadel master key on first run; never committed.
ensure_masterkey() {
  local f="$DIR/zitadel/.env"
  local current
  current="$(grep '^ZITADEL_MASTERKEY=' "$f" 2>/dev/null | cut -d= -f2- || true)"
  if [[ -z "$current" ]]; then
    local key
    key="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"
    grep -v '^ZITADEL_MASTERKEY=' "$f" > "$f.tmp" 2>/dev/null || true
    mv "$f.tmp" "$f"
    printf 'ZITADEL_MASTERKEY=%s\n' "$key" >> "$f"
    echo "  generated ZITADEL_MASTERKEY (32 chars)"
  fi
}

log "Preparing local secrets"
for d in "${PLATFORMS[@]}"; do ensure_env "$d"; done

log "Namespace"
kubectl apply -f "$DIR/00-namespace.yaml"

log "Datastores + observability (${PLATFORMS[*]})"
for d in "${PLATFORMS[@]}"; do kubectl apply -k "$DIR/$d"; done

if [[ "$INCLUDE_ZITADEL" == "1" ]]; then
  ensure_env zitadel
  ensure_masterkey
  log "Waiting for postgres (Zitadel depends on it)"
  kubectl -n "$NS" rollout status deploy/postgres --timeout=180s
  log "Zitadel"
  kubectl apply -k "$DIR/zitadel"
fi

log "Current state"
kubectl -n "$NS" get pods,svc
echo
echo "RabbitMQ management UI: http://localhost:31672 (admin/password by default)."
echo "Grafana (otel-lgtm): http://localhost:30000 (anonymous admin; OTLP on :30318)."
[[ "$INCLUDE_ZITADEL" == "1" ]] && echo "Zitadel console: http://localhost:30080 (may take ~1 min to init)."
exit 0
