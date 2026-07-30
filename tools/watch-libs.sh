#!/usr/bin/env bash
# Keep every workspace library's `dist` in step with its `src` while an app runs.
#
# The Next apps resolve `@r10c/*` through `exports` → `import` → **dist** (they
# cannot consume the `@r10c/source` condition: Turbopack has no `conditionNames`
# knob, and Next's swc only parses decorators in the legacy `experimentalDecorators`
# emit, which would break the stage-3 `Symbol.metadata` entity decorators). So an
# edit under `packages/**/src` is invisible to a running `next dev` until the
# library is rebuilt — this watcher is what rebuilds it. See
# docs/DEVELOPING.md → "Library edits reload everywhere".
#
# Wired as the root `watch-libs` nx target that every app `dev` depends on. It is
# ONE watcher for the whole fleet on purpose: `marketplace-admin-app:dev` chains
# `auth-app:dev`, and two per-app watchers would fire two concurrent builds of the
# same shared library on a single keystroke. All apps depend on this same task, so
# Nx's task graph dedupes it to a single process — and kills it on Ctrl-C.
#
#   tools/watch-libs.sh    (or: pnpm exec nx run @r10c/source:watch-libs)
#
# The selector is the five library `layer:` tags — every buildable package carries
# exactly one of them, and apps/services (`layer:app`) carry none of them. Do NOT
# write it as `'*,!tag:layer:app'`: `*` also matches the workspace root project,
# whose project root is `''`, so every file not inside another project (docs,
# `infra/**`, this script) would attribute to it and fire the watcher. Nx selectors
# also cannot use brace patterns — `--projects` is split on `,` before matching.
#
# `--excludeTaskDependencies` is here because rebuilding a library's dependencies is
# both wasted work and a hazard. Per-file swc inlines nothing, so a dependency's
# `dist` is already what the app loads, and a dependency you edited gets its own
# spawn anyway. The hazard: saving two libraries at once spawns two nested `nx`
# processes that share `NX_INVOCATION_ROOT_PID`, so with `^build` pulled in both can
# register the same shared dependency's `build` task — the collision Nx answers with
# `Recursive task invocation detected` (the failure that forced `dependsOn: []` on
# the service `build` targets), which would leave a library silently stale.
# `--skipSync` keeps a background process from rewriting tsconfig references mid-session.
#
# `$NX_PROJECT_NAME` MUST stay unexpanded here: `nx watch` looks for that literal
# in the command string and substitutes the changed project per spawn. Hence the
# single quotes, and hence this script rather than an inline `nx:run-commands`
# string — an inline one is expanded by the outer shell first, into nothing.
#
# The watcher does not chase its own output: the Nx daemon's file watcher honours
# `.gitignore`, and `dist` is ignored. It does need the Nx daemon (`nx watch` exits
# if it is off, so never `NX_DAEMON=false` for dev), and an Nx version change from a
# `pnpm install` mid-session ends the watcher — restart `dev` after one.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec pnpm exec nx watch \
  --projects tag:layer:business,tag:layer:entifix,tag:layer:implementation,tag:layer:shell,tag:layer:utils \
  -- pnpm exec nx run-many -t build -p '$NX_PROJECT_NAME' \
    --excludeTaskDependencies --skipSync
