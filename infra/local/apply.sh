#!/usr/bin/env bash
# Bring up the local marketplace infrastructure on the current kube-context
# (expected: minikube). Idempotent — safe to re-run.
#
# Zitadel is no longer optional: it authenticates every sign-in, so a fleet
# without it has no way to obtain a session. It still applies last, because its
# init needs Postgres to exist first.
#
# The v2 hosted login (`zitadel-login`) is NOT applied here. It mounts a token
# the core only mints when it creates its first instance, so it belongs to the
# L6 rung of `ensure.sh`, after Zitadel is serving.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

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
ensure_masterkey

log "Namespace"
kubectl apply -f "$DIR/00-namespace.yaml"

log "Datastores + observability (${PLATFORMS[*]})"
for d in "${PLATFORMS[@]}"; do kubectl apply -k "$DIR/$d"; done

log "Current state"
kubectl -n "$NS" get pods,svc
echo
echo "RabbitMQ management UI: http://localhost:31672 (admin/password by default)."
echo "Grafana (otel-lgtm): http://localhost:30000 (anonymous admin; OTLP on :30318)."
echo "Mailpit inbox: http://localhost:30826 (every mail Zitadel sends lands here)."
echo "Zitadel console: http://localhost:30080 (may take ~1 min to init)."
echo "Zitadel hosted login: http://localhost:$LOGIN_NODEPORT/ui/v2/login (applied by the L6 rung)."
exit 0
