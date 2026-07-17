# R10c

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

Nx + pnpm monorepo for the **entifix** entity framework and the marketplace apps built on it. Everything is layered top-to-bottom and **dependencies only point downward**.

## Status (2026-07)

Active development. In place today:

- **entifix** entity framework — core, business contracts + use-cases, REST adapter, **Mongo adapter**, and the React integration.
- Domains: **product-configuration-management** (`Product`/`ProductBrand`/`ProductCategory`) and **authn** (`UserIdentity`/`EntityIdentifier`).
- Frontends (`marketplace-app`, `marketplace-admin-app`, `auth-app`) and Effect-native backends.
- Backends wired to real datastores: **config-service → PostgreSQL**, **marketplace-admin-service** & **auth-service → MongoDB**, seeded on first boot.

The `load`/`get` read paths run end-to-end over both REST and Mongo. `save`/`delete` exist on the adapters but aren't driven by a UI/route yet; Zitadel/session auth is still a stub.

## Documentation

| Doc | What's inside |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, the use-case + adapter mechanism, backends, and the current domain structure. |
| [docs/ENTIFIX.md](docs/ENTIFIX.md) | Deep dive: how self-describing entities + Effect DI make one use-case run in any environment. |
| [docs/WORKSPACE.md](docs/WORKSPACE.md) | Nx setup, file structure, `@r10c/source` resolution, and every command. |
| [docs/CONTRIBUTE.md](docs/CONTRIBUTE.md) | Conventions and good practices (layering, entities, backends, commits). |
| [infra/local/README.md](infra/local/README.md) | The minikube platform (MongoDB, Redis, Postgres, Zitadel). |
| [CLAUDE.md](CLAUDE.md) | Condensed guide for AI assistants working in the repo. |

## Architecture at a glance

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/{next,effect}/*     ← framework shells: Next pages+adapters / the effect-service base
packages/implementation/<domain>/*  ← domain wired to a delivery mechanism (React organisms)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework (core / business / rest-client / mongo-client / react/*)
packages/utils/ts/*                 ← generic TS helpers
```

The framework is decorator + [Effect](https://effect.website)-based:

- **`entifix-ts-core`** — `@entity()` / `@accessor()` register metadata on `MetaEntity`; domain types (`Entity`, `EntityLoadRequest`, `EntityPage`, filtering/sorting); the shared (de)serializer; **entity links** (`EntityLink` / `EntityCollectionLink`) that model relations as either a foreign key or embedded data, resolved lazily through an `EntityLinkResolver`.
- **`entifix-ts-business`** — repository/resolver contracts + use-case factories over Effect. Repositories return `Effect<T, EntifixError>`; dependencies are injected as `Context.Tag`s.
- **`entifix-ts-rest-client`** / **`entifix-ts-mongo-client`** — turn an entity into an `EntityRepository` over HTTP (web) or MongoDB (backend). The same use-case runs against either; only the composition root swaps the adapter.
- **`entifix-react-*`** — `controls` (UI primitives) and `integration` (Effect-aware hooks: `useDataLoading`, `useEntityLinkResolver`).

Backends are **Effect-native** (no Nest): they compose `@r10c/shells-effect-service` (`@effect/platform` HTTP + `/api/health` + `Layer` DI + graceful shutdown) and compile stage-3 like entifix, so they import entity classes natively. Frontends and backends both resolve runtime config through `config-service` (`:3190`), never hardcoded.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ENTIFIX.md](docs/ENTIFIX.md) for the full picture.

## Quickstart

Requires **Node 25.1** and **pnpm 10.21** (see `engines`).

```sh
pnpm install

# Bring up local infrastructure (minikube)
minikube start --ports 30017:30017,30379:30379,30432:30432,30080:30080
infra/local/apply.sh

# Run an app or service (unified convention — each starts its own dependencies)
pnpm nx run marketplace-admin-app:dev      # :3001 (starts admin-service + config-service)
pnpm nx run config-service:dev             # :3190 (Postgres)
pnpm nx run marketplace-admin-service:dev  # :3101 (Mongo)
pnpm nx run auth-service:dev               # :3102 (Mongo)
```

Full command reference (build, typecheck, lint, test, e2e, affected, graph) is in [docs/WORKSPACE.md](docs/WORKSPACE.md).
