#!/usr/bin/env bash
# Run this checkout against its own local entifix instead of the release.
#
#   pnpm run entifix:local               (or: bash tools/entifix/local.sh)
#
# Starts entifix's `dev-sync` in the clone `entifix:checkout` made: it builds
# every entifix package once, copies each over the release installed here, then
# rebuilds and re-copies whatever you save. Runs until Ctrl-C; the copies stay
# until `entifix:registry` puts the release back.
#
# ⚠️ Every inherited `NX_*` variable is cleared first. Started through this
# repository's Nx, the environment carries its workspace root, its task id and
# its `NX_INVOCATION_ROOT_PID` — and entifix's Nx reading those believes it is a
# nested task of this workspace, which is how a shared root pid produces
# `Recursive task invocation detected`. `nx watch` also needs the daemon, so an
# inherited `NX_DAEMON=false` would stop it cold.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dir="${ENTIFIX_DIR:-.entifix}"
checkout="$(cd "$root" && cd "$dir" 2>/dev/null && pwd)" || checkout=""

if [[ -z "$checkout" || ! -f "$checkout/nx.json" ]]; then
  echo "entifix:local: no entifix checkout at $dir — run \`pnpm run entifix:checkout\` first" >&2
  exit 1
fi

while IFS= read -r name; do
  unset "$name"
done < <(env | sed -n 's/^\(NX_[A-Za-z0-9_]*\)=.*/\1/p')

export ENTIFIX_CONSUMERS="$root"
cd "$checkout"
exec pnpm exec nx run @entifix/source:dev-sync
