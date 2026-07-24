<!-- Single source imported by CLAUDE.md and docs/DEVELOPING.md. Edit here only. -->

Nx 23 monorepo with pnpm workspaces. Pinned toolchain: **Node 26.4**, **pnpm 11.9**
(see `engines` in the root `package.json`). Always use `pnpm` (never `npm`/`yarn`)
and run Nx via `pnpm nx …` (or `pnpm exec nx`). Project names are scoped
`@r10c/<name>`, but Nx accepts the unscoped suffix for most commands
(e.g. `marketplace-app`, `entifix-ts-core`).

```sh
# Dev — unified convention for EVERY app/service (each starts its own deps)
pnpm nx run marketplace-app:dev            # :3000
pnpm nx run marketplace-admin-app:dev      # :3001 (auto-starts admin-service + config-service)
pnpm nx run auth-app:dev                   # :3002
pnpm nx run config-service:dev             # :3190 (Postgres; runs ensure-infra first)
pnpm nx run marketplace-admin-service:dev  # :3101 (Mongo; +config-service)
pnpm nx run auth-service:dev               # :3102 (Mongo; +config-service)
pnpm nx run transaction-manager:dev        # :3103 (Mongo + RabbitMQ; passive saga tracker)

# Build / typecheck / lint / test a single project
pnpm nx build <project>
pnpm nx typecheck <project>
pnpm nx lint <project>                        # add --fix to autofix (import sort etc.)
pnpm nx test <project>                        # all tests in the project
pnpm nx test <project> -- <pattern>           # single test by name/file
pnpm nx test <project> -- --watch
pnpm nx test <project> --coverage             # every packages/* project is gated at 100%

# E2E (Playwright for Next apps, Vitest for services).
# E2E_PROFILE=mock is the DEFAULT and hermetic — no infra, runs on every PR.
pnpm nx e2e marketplace-admin-app-e2e
pnpm nx e2e marketplace-admin-service-e2e
# The same journeys against real infrastructure (start the service first):
E2E_PROFILE=live MARKETPLACE_ADMIN_SERVICE_URL=http://localhost:3101 \
  pnpm nx e2e marketplace-admin-app-e2e

# Affected-only (what the pre-commit hook runs against origin/main)
pnpm nx affected -t lint,build,test
pnpm nx affected -t lint,build --base=origin/main --head=HEAD

# Everything / explore the graph
pnpm nx run-many -t build
pnpm nx run-many -t typecheck
pnpm nx show projects
pnpm nx show project <project>
pnpm nx graph
pnpm nx sync                 # sync tsconfig project references after adding deps
pnpm nx local-registry       # verdaccio, for testing publishes
```
