#!/usr/bin/env bash
# Give this checkout its own entifix clone, gitignored, at $ENTIFIX_DIR.
#
#   pnpm run entifix:checkout            (or: bash tools/entifix/checkout.sh)
#
#   ENTIFIX_DIR   where the clone lives, relative to this repository (.entifix)
#   ENTIFIX_REPO  what to clone (git@github.com:r10c-technologies/entifix.git)
#   ENTIFIX_REF   a branch or tag to clone; the default branch when unset
#
# One clone per consumer checkout rather than one entifix beside every consumer:
# a sibling checkout has one branch at a time, so two consumers — two projects,
# or two worktrees of one — changing entifix at once would fight over it.
#
# Clones only when the directory is missing, and never touches an existing clone
# beyond `pnpm install`: its branch and uncommitted work are yours. Refuses a
# directory this repository would commit, because a clone that is not ignored is
# 100 MB of someone else's history one `git add .` away from a pull request.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

dir="${ENTIFIX_DIR:-.entifix}"
repo="${ENTIFIX_REPO:-git@github.com:r10c-technologies/entifix.git}"

# Asked with a trailing slash: a directory pattern such as `/.entifix/` does not
# match the bare path of a directory that does not exist yet.
if ! git check-ignore -q "${dir%/}/"; then
  echo "entifix:checkout: $dir is not gitignored here — add it to .gitignore first" >&2
  exit 1
fi

if [[ -e "$dir" ]]; then
  if [[ ! -f "$dir/nx.json" ]]; then
    echo "entifix:checkout: $dir exists but is not an entifix checkout — move it aside" >&2
    exit 1
  fi
  echo "entifix:checkout: $dir already present, on $(git -C "$dir" rev-parse --abbrev-ref HEAD) @ $(git -C "$dir" rev-parse --short HEAD)"
else
  git clone ${ENTIFIX_REF:+--branch "$ENTIFIX_REF"} "$repo" "$dir"
fi

pnpm --dir "$dir" install
