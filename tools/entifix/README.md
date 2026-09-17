# entifix swap kit

Run a consumer of `@entifix/*` against a local entifix checkout, and put the
release back. Four commands, one per script:

| Command                     | Script                    | Does                                                                                           |
| --------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm run entifix:checkout` | `checkout.sh`             | clones entifix into `.entifix/` if it is missing, then `pnpm install` inside it                |
| `pnpm run entifix:local`    | `local.sh`                | runs entifix's `dev-sync` from that clone: build, copy over the release, rebuild on every save |
| `pnpm run entifix:registry` | `src/guard.mjs --restore` | deletes the synced copies and relinks the release, in about two seconds                        |
| `pnpm run entifix:status`   | `src/status.mjs`          | the release, or which packages are synced and from which entifix commit                        |
| (pre-commit)                | `src/guard.mjs`           | refuses a commit while a synced copy is installed; `ENTIFIX_DEV_SYNC_OK=1` lets one through    |
| (Nx runtime input)          | `src/fingerprint.mjs`     | keeps a synced build out of the task cache                                                     |

Every consumer checkout — each repository, and each worktree of one — keeps its
**own** clone, so two of them can change entifix on two branches at once. An
entifix branch one consumer needs from another has to be pushed and fetched like
any other branch.

## What a consumer must provide

The scripts import nothing from the consumer and are configured by environment
(`ENTIFIX_DIR`, `ENTIFIX_REPO`, `ENTIFIX_REF`), so the folder can be copied into
another consumer — or into entifix — unchanged. The consumer supplies:

- **Every `@entifix/*` at one version from the registry.** A `link:` or `file:`
  specifier resolves `effect` and `react` from entifix's own `node_modules`, and
  two copies of either break identity without an error. The sync copies files
  into the consumer's own store instead, where they resolve the consumer's.
- **`/.entifix/` in `.gitignore`**, and in any tool that walks the tree without
  reading `.gitignore` (ESLint flat config does not). `checkout.sh` refuses to
  clone into a path the repository would commit.
- **`node <kit>/src/guard.mjs` in the pre-commit hook.** CI installs the pinned
  release, so a commit that works only against a synced copy fails there.
- **`{ "runtime": "node <kit>/src/fingerprint.mjs" }` in the task inputs** every
  cacheable target reads (`sharedGlobals` in Nx). Nx keys an installed package on
  its lockfile version, and a synced copy keeps it; without this input a build
  against the local entifix and a build against the release share a cache entry.
- **Nx targets or scripts** that run the four commands from the repository root.

## Why a copy and not pnpm's own mechanisms

`pnpm install --force` does not undo a sync — pnpm 11's optimistic repeat
install answers "Already up to date" and leaves every copy in place; `guard.mjs
--restore` deletes the synced store entries and installs without that shortcut.
A git submodule would record an entifix commit in the consumer's history, and a
workspace glob over the clone would rewrite the lockfile whenever the clone is
present, so CI and a laptop would resolve differently.
