#!/usr/bin/env bash
# Ensure the local dev datastores (MongoDB :30017, Postgres :30432) are reachable
# before a backend service starts. Idempotent and fast when everything is up:
# it only applies the infra manifests when a datastore is not yet answering.
#
# Wired as the `ensure-infra` nx target that each backend `dev` depends on.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS=marketplace-local-infra

# host:port pairs the services connect to (minikube NodePorts).
PORTS=(30017 30432)

port_open() {
  # nc -z returns 0 when the TCP port accepts a connection.
  nc -z 127.0.0.1 "$1" >/dev/null 2>&1
}

all_ports_open() {
  for p in "${PORTS[@]}"; do
    port_open "$p" || return 1
  done
  return 0
}

if all_ports_open; then
  echo "==> Local infra reachable (ports: ${PORTS[*]})"
  exit 0
fi

echo "==> Local datastores not reachable — checking minikube"
if ! command -v minikube >/dev/null 2>&1; then
  echo "ERROR: minikube is not installed. Install it and run:" >&2
  echo "  minikube start --ports 30017:30017,30379:30379,30432:30432,30080:30080" >&2
  exit 1
fi

if ! minikube status >/dev/null 2>&1; then
  echo "ERROR: minikube is not running. Start it with:" >&2
  echo "  minikube start --ports 30017:30017,30379:30379,30432:30432,30080:30080" >&2
  exit 1
fi

echo "==> Applying local infra manifests"
bash "$DIR/apply.sh"

echo "==> Waiting for datastores to accept connections"
for _ in $(seq 1 60); do
  if all_ports_open; then
    echo "==> Local infra ready (ports: ${PORTS[*]})"
    exit 0
  fi
  sleep 2
done

echo "ERROR: datastores did not become reachable in time." >&2
kubectl -n "$NS" get pods 2>/dev/null || true
exit 1
