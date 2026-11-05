# 74. Change Validation, and what may trust the cache it carries

- Status: Accepted
- Date: 2026-11-05
- Area: platform
- Read when: a CI job is slow because it rebuilds what another job built, adding a job or a check to `change_validation.yml`, a check passed without running, the Actions cache is near its 10 GB, or about to restore `.nx/cache` between runners — a restored `.nx/cache` is ignored by Nx 24, and a repository-wide check must never read from the cache

## Context

The pull-request check ran every job on an empty Nx cache, because nothing a
build produced reached another job. Run 41913903430 is typical:

- The e2e job reported `Cache: 0/65 hit`. It rebuilt 53 dependency tasks, about
  120 of its 217 seconds, before the first journey ran.
- Each of ten build chunks rebuilt every library it depended on.
- Every job ran its own `pnpm install`.

The workflow ran only on pull requests, never on `main`. An Actions cache is
readable from the ref that wrote it and from `main`, so every entry was
private to one pull request. The repository held 36 entries, 10.7 GB, over its
10 GB limit, and most of it was the same pnpm store and Playwright browser
saved once per pull request.

Hosting the cache in a third-party service was ruled out: it stays in GitHub.

The same decision was taken for entifix first, in its own ADR 0023, where the
mechanism was measured. This record states it for r10c's graph.

## Decision

### The cache travels as entries addressed by hash, served by a loopback server

Nx 24 replays only cache entries indexed in its database, a SQLite file named
after the machine (`.nx/workspace-data/<machine-id>-v6.db`). Every runner is a
new machine, so a restored `.nx/cache` is ignored as "unrecognized artifacts",
and `NX_REJECT_UNKNOWN_LOCAL_CACHE=0`, which used to override that, is not
supported by the database cache.

Nx also ships a client for a self-hosted HTTP cache, which needs no index. So
every job that uses the cache starts `tools/ci/nx-remote-cache.mjs` on
`127.0.0.1` behind a token minted for that job, over `.nx-remote/entries`. An
entry is a file named by its task hash, so the entries of several jobs merge
by copying. That directory is what `actions/cache` carries between runs and
what artifacts carry between the jobs of one run.

### `main` warms the cache; a pull request also keeps its own

The workflow now also runs on push to `main`. That run validates the whole
graph and saves the cache, and a pull request without an entry of its own
starts from it. A pull request also saves into its own scope, so its next push
starts from its last run. The save prunes to the entries some job of the run
read or wrote. One entry is kept per ref, and `cache_cleanup.yml` deletes a
pull request's caches when it closes. `node_modules` and the Playwright browser
are saved from `main` only, and the redundant pnpm-store cache is gone.

### What never reads the cache

The repository assertions run `--skip-nx-cache`: `@r10c/i18n-check`,
`@r10c/docs-check`, `@r10c/slices` and `@r10c/conventions`. Each reads the whole
tree while its hash covers its own project, so a pull request that breaks a
slice declaration or a documentation claim would not change it, and a replayed
pass would hide the break. They run in their own job, **Repository
assertions**, apart from `Lint`, which is affected-scoped and cached.

### Libraries once, applications fan out

- **Build libraries** runs `build,typecheck` for every affected library on one
  runner.
- **Build (…)** reads the libraries from the cache, with each Next application
  on its own runner and the webpack services four to a runner.
- **E2E services** runs every Vitest journey in one job. The journeys start
  their service from source, so they need neither a browser nor a build.
- **E2E browser (…)** runs one Playwright suite per application and reads that
  application's build from the cache.

The gate is **Done**, as in entifix, in place of `CI Gate`.

## Consequences

- A pull request that changes `.github/` or `tools/ci/` runs the whole graph,
  because such a change affects no project.
- A cache that fails to save costs the next run time, never this run its
  result: `Save the Nx cache` is not in `Done`'s `needs`.
- A job that cannot reach its server fails, and so does a server answering the
  wrong token: Nx's client refuses the endpoint rather than building around it.
- `@r10c/fleet-e2e` is classified as a service suite and collects nothing under
  the mock profile, by design (its specs are `*.live.spec.ts`; see
  DEVELOPING.md → The live pass). Scheduling it costs seconds, and keeps it on
  the one `e2e` target name every journey uses.
