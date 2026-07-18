#!/usr/bin/env bash
# Tear down the local infrastructure. PersistentVolume data is retained
# (reclaimPolicy: Retain) unless you also wipe the hostPaths — see README.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS=marketplace-local-infra

# Reverse order of apply.sh.
for d in zitadel postgres rabbitmq redis mongodb; do
  kubectl delete -k "$DIR/$d" --ignore-not-found
done

echo
echo "Platform workloads deleted. Namespace '$NS' and PV data are kept."
echo "To remove the namespace:      kubectl delete ns $NS"
echo "To wipe persisted data (all): minikube ssh -- sudo rm -rf \\"
echo "  /data/marketplace-mongodb /data/marketplace-redis \\"
echo "  /data/marketplace-rabbitmq /data/marketplace-postgres"
