#!/usr/bin/env bash
# Tear down the local infrastructure. PersistentVolume data is retained
# (reclaimPolicy: Retain) unless you also wipe the hostPaths — that is what
# `reset.sh` does, and why it, not this, is the fix for a bad-data problem.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

# Reverse order of apply.sh; zitadel included even though it is opt-in there,
# so a teardown still removes a cluster brought up with INFRA_INCLUDE_ZITADEL=1.
for d in zitadel otel-lgtm postgres rabbitmq redis mongodb; do
  kubectl delete -k "$DIR/$d" --ignore-not-found
done

echo
echo "Platform workloads deleted. Namespace '$NS' and PV data are kept."
echo "To remove the namespace:      kubectl delete ns $NS"
echo "To wipe persisted data (all): bash infra/local/reset.sh"
