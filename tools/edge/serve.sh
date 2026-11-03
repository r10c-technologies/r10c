#!/usr/bin/env bash
# The local edge: Envoy on 3000 and 3001, in front of Next on 3200/3201 and
# realtime-service on 3191 (ADR 0072). The `@r10c/edge:serve` target, which
# every frontend's `dev` depends on.
#
# A container rather than a binary because Envoy publishes Linux builds only,
# and Docker is already required here — minikube runs on its docker driver. The
# image is pinned by digest, which is the checksum: a tag can be moved, a digest
# cannot. `@r10c/docs-check` fails an IMAGE without one.
#
# ⚠️ **The container is shared, not owned by the terminal that started it.**
# `mp:dev` and `back-office:dev` both depend on this target, and nx ends a whole
# run when one of its continuous tasks exits. A serve that replaced the
# container would therefore tear down the *other* terminal's fleet, and one
# that stopped it on exit would do the same on Ctrl-C. So this script starts
# the container detached only when it is missing or stale — a different image,
# or a different `envoy.yaml`, recorded as a label — and otherwise just follows
# its log. Exiting stops the log, never the edge. `edge:free-ports` and
# `pnpm run dev-ports:free` are what remove it.
#
# `host.docker.internal` is how the container reaches the host's processes.
# Docker Desktop provides it; a Linux runner needs the `host-gateway` mapping,
# and the flag is harmless where it is already defined.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE='envoyproxy/envoy:v1.40.0@sha256:459f2a6404c340fe6afccd69d85527012d47f3c036765493e6f8f3113fa384de'
CONTAINER='r10c-edge'
CONFIG="$REPO_ROOT/tools/edge/envoy.yaml"

if ! docker info >/dev/null 2>&1; then
  echo "edge: Docker is not running — start Docker Desktop (minikube needs it too)." >&2
  exit 1
fi

# The config is bind-mounted, so Envoy would keep serving the one it loaded at
# start: a changed file means a new container.
digest="$(shasum -a 256 "$CONFIG" | cut -c1-16)"
wanted="true $IMAGE $digest"
actual="$(docker inspect -f '{{.State.Running}} {{.Config.Image}} {{index .Config.Labels "r10c.edge.config"}}' "$CONTAINER" 2>/dev/null || true)"

if [[ "$actual" != "$wanted" ]]; then
  # Removes a stale container, and any leftover listener of this workspace's on
  # the origins — a `next dev -p 3001` from before the edge, say.
  bash "$REPO_ROOT/tools/free-ports.sh" 3000 3001
  docker run -d --rm --name "$CONTAINER" \
    --label "r10c.edge.config=$digest" \
    --add-host=host.docker.internal:host-gateway \
    -p 3000:3000 -p 3001:3001 \
    -v "$CONFIG:/etc/envoy/envoy.yaml:ro" \
    "$IMAGE" \
    -c /etc/envoy/envoy.yaml --log-level warn >/dev/null
  echo "edge: started $CONTAINER on :3000 and :3001"
else
  echo "edge: $CONTAINER already serving :3000 and :3001"
fi

# Continuous for nx: the target lives as long as the container does, and ends
# — taking its fleet with it, loudly — if the edge dies.
exec docker logs -f --since 1s "$CONTAINER"
