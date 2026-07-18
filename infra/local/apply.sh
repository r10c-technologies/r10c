#!/usr/bin/env bash
# Bring up the local marketplace infrastructure on the current kube-context
# (expected: minikube). Idempotent — safe to re-run.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS=marketplace-local-infra
PLATFORMS=(mongodb redis rabbitmq postgres zitadel)

# Ensure each platform has a real .env (copied from its committed example).
ensure_env() {
  local d="$1"
  if [[ ! -f "$DIR/$d/.env" ]]; then
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

echo "==> Preparing local secrets"
for d in "${PLATFORMS[@]}"; do ensure_env "$d"; done
ensure_masterkey

echo "==> Namespace"
kubectl apply -f "$DIR/00-namespace.yaml"

echo "==> Datastores (mongodb, redis, rabbitmq, postgres)"
for d in mongodb redis rabbitmq postgres; do kubectl apply -k "$DIR/$d"; done

echo "==> Waiting for postgres (Zitadel depends on it)"
kubectl -n "$NS" rollout status deploy/postgres --timeout=180s

echo "==> Zitadel"
kubectl apply -k "$DIR/zitadel"

echo "==> Current state"
kubectl -n "$NS" get pods,svc
echo
echo "Done. Zitadel console: http://localhost:30080 (may take ~1 min to init)."
echo "RabbitMQ management UI: http://localhost:31672 (admin/password by default)."
