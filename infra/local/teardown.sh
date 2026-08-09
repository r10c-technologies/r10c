#!/usr/bin/env bash
# Tear down the local infrastructure. PersistentVolume data is retained
# (reclaimPolicy: Retain) unless you also wipe the hostPaths — that is what
# `reset.sh` does, and why it, not this, is the fix for a bad-data problem.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$DIR/lib.sh"

# The hosted login first: it is applied last (by its own rung, after the core has
# minted its token) so it comes down first.
kubectl delete -k "$DIR/$LOGIN_PLATFORM" --ignore-not-found
kubectl -n "$NS" delete secret "$LOGIN_SECRET" --ignore-not-found

# Reverse order of apply.sh, derived from PLATFORMS so a new datastore is never
# left running by a teardown that forgot about it.
for (( i = ${#PLATFORMS[@]} - 1; i >= 0; i-- )); do
  kubectl delete -k "$DIR/${PLATFORMS[$i]}" --ignore-not-found
done

echo
echo "Platform workloads deleted. Namespace '$NS' and PV data are kept."
echo "To remove the namespace:      kubectl delete ns $NS"
echo "To wipe persisted data (all): bash infra/local/reset.sh"
