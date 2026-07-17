# Workspace (Nx + pnpm)

> **Status (2026-07)** — Nx 22 monorepo, pnpm workspaces. Pinned toolchain:
> **Node 25.1**, **pnpm 10.21** (see `engines` in the root `package.json`). All
> apps/services run through the unified `pnpm nx run <artifact>:dev` convention;
> service `serve` was replaced by `dev`.

Always use `pnpm` (never `npm`/`yarn`) and run Nx via `pnpm nx …` (or
`pnpm exec nx`). Project names are scoped `@r10c/<name>`, but Nx accepts the
unscoped suffix for most commands (e.g. `marketplace-app`, `entifix-ts-core`).

## File structure

```
apps/
  <domain>-app/            Next.js frontend (App Router, React 19, Tailwind)
  <domain>-service/        Effect-native backend (@effect/platform)
  config-service/          Postgres-backed configuration service
  *-e2e/                   Playwright (Next apps) / Jest (services)
packages/
  entifix/ts/{core,business,rest-client,mongo-client}   entity framework (TS)
  entifix/react/{controls,integration}                  React side of the framework
  entifix/style/                                        design tokens
  business/ts/<domain>/     pure entities + use-cases (no framework)
  implementation/<domain>/react/   React organisms for a domain
  shells/next/<shell>/      Next pages + client adapters
  shells/effect/service/    shared backend base (makeService, config helpers)
  utils/ts/{array,date,object,type}   generic helpers
infra/local/                minikube platform (MongoDB, Redis, Postgres, Zitadel)
docs/                       this documentation
nx.json  tsconfig.base.json  pnpm-workspace.yaml  package.json (root)
```

### Workspace resolution: the `@r10c/source` condition

`tsconfig.base.json` sets `customConditions: ['@r10c/source']`, and every library's
`package.json` `exports` maps `.` → `@r10c/source: ./src/index.ts` (plus the built
`dist` for external consumers). So **inside the workspace, imports resolve to each
package's `src/index.ts`** — no rebuild needed between dependent libraries during
dev/typecheck. When you add a library, mirror this `exports` shape or cross-package
imports won't resolve in dev.

Type declarations come from the inferred `@nx/js/typescript` `build`/`typecheck`
targets driven by each project's `tsconfig.lib.json` (composite project
references; root `tsconfig.json` lists every member — keep it updated, or run
`pnpm nx sync`). Library builds use `@nx/js:swc` (TS-only libs) or Rollup (React
libs); services use webpack.

## Common commands

```sh
# Dev — unified convention for EVERY app/service (each starts its own deps)
pnpm nx run marketplace-app:dev            # :3000
pnpm nx run marketplace-admin-app:dev      # :3001 (auto-starts admin-service + config-service)
pnpm nx run auth-app:dev                   # :3002
pnpm nx run config-service:dev             # :3190 (Postgres; runs ensure-infra first)
pnpm nx run marketplace-admin-service:dev  # :3101 (Mongo; +config-service)
pnpm nx run auth-service:dev               # :3102 (Mongo; +config-service)

# Build / typecheck / lint / test a single project
pnpm nx build <project>
pnpm nx typecheck <project>
pnpm nx lint <project>            # add --fix to autofix (import sort etc.)
pnpm nx test <project>                       # all tests in the project
pnpm nx test <project> -- <pattern>          # single test by name/file
pnpm nx test <project> -- --watch

# E2E (Playwright for Next apps, Jest for services)
pnpm nx e2e marketplace-admin-app-e2e
pnpm nx e2e marketplace-service-e2e

# Affected-only (what the pre-commit hook runs against origin/main)
pnpm nx affected -t lint,build,test
pnpm nx affected -t lint,build --base=origin/main --head=HEAD

# Everything
pnpm nx run-many -t build
pnpm nx run-many -t typecheck

# Explore
pnpm nx show projects
pnpm nx show project <project>
pnpm nx graph
pnpm nx sync            # sync tsconfig project references after adding deps

# Local publish registry (verdaccio)
pnpm nx local-registry
```

## Dev targets & dependency orchestration

- Backend `dev` targets are `continuous` (`@nx/js:node`) and `dependsOn`:
  - `build`
  - `ensure-infra` — runs `infra/local/ensure.sh`, which checks that the MongoDB
    (`:30017`) and Postgres (`:30432`) NodePorts answer and applies the infra
    manifests if not. It does **not** auto-`minikube start` (the `--ports` mapping
    must be set at cluster create).
  - the Mongo services additionally depend on `@r10c/config-service:dev` (their
    config source), started as an Nx continuous dependency.
- Frontends already carry `dev`; `dev-w-deps` starts an app together with its
  backends.
- An inferred `serve` target still exists on the webpack apps (from the
  `@nx/webpack` plugin) but `dev` is the canonical one used everywhere.

## Local infrastructure

`infra/local` is a minikube platform (MongoDB, Redis, PostgreSQL, Zitadel) as
per-platform kustomize folders. Secrets are never committed: a `secretGenerator`
reads a git-ignored `.env` (committed `.env.example` holds LOCAL DEV ONLY
defaults). Bring it up:

```sh
minikube start --ports 30017:30017,30379:30379,30432:30432,30080:30080
infra/local/apply.sh    # or let a backend `dev` target's ensure-infra do it
```

NodePorts follow `30000 + canonical port`: Mongo `30017`, Redis `30379`,
Postgres `30432`, Zitadel console `30080`.

## Adding a project

Prefer the Nx generators, then mirror the workspace conventions (`@r10c/source`
exports, `tsconfig.lib.json`, add to root `tsconfig.json` references):

```sh
pnpm nx g @nx/next:app <name>-app
pnpm nx g @nx/react:lib <name>
```

Adding a **domain** = next port index → `300N`/`310N`, plus a seed row in
`apps/config-service/src/db.ts`. See [CONTRIBUTE.md](./CONTRIBUTE.md) for the
step-by-step of adding an entity across the layers.

## Commits

Conventional Commits with Nx scopes (`@commitlint/config-nx-scopes`): the scope
is the project name, e.g. `feat(entifix-ts-core): …`. `.husky/pre-commit` runs
`lint-staged` then `pnpm nx affected -t lint,build --base=origin/main` (it
`git fetch`es first, so origin must be reachable).
