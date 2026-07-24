# R10c

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

Nx + pnpm monorepo for the **entifix** entity framework and the marketplace apps built on it. Everything is layered top-to-bottom and **dependencies only point downward**.

## Status (2026-07)

Active development. In place today:

- **entifix** entity framework — core, business contracts + use-cases, REST adapter, **Mongo adapter**, and the React integration.
- Domains: **product-configuration-management** (`Product`/`ProductBrand`/`ProductCategory`) and **authn** (`UserIdentity`/`EntityIdentifier`).
- Frontends (`marketplace-app`, `marketplace-admin-app`, `auth-app`) and Effect-native backends.
- Backends wired to real datastores: **config-service → PostgreSQL**, **marketplace-admin-service** & **auth-service → MongoDB**, seeded on first boot.

Full CRUD (`load`/`get`/`save`/`delete`) runs end-to-end over both REST and Mongo, writes go through the CQRS **transaction** facade (Redis locks + RabbitMQ events, tracked by `transaction-manager`), and credential auth is real (Redis sessions + cookie-carried HS256 JWTs). Zitadel/RS256/ABAC are still deferred. Observability (OTLP → local `otel-lgtm`) is wired on the services.

## Documentation

| Doc                                            | What's inside                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | Layering, the use-case + adapter mechanism, backends, auth, transactions, observability, and the domain structure.             |
| [docs/ENTIFIX.md](docs/ENTIFIX.md)             | Deep dive: how self-describing entities + Effect DI make one use-case run in any environment.                                  |
| [docs/FRONTEND.md](docs/FRONTEND.md)           | The client side: design system (tokens, flex-first layout primitives, Storybook) and the workspace tabs + TanStack data layer. |
| [docs/DEVELOPING.md](docs/DEVELOPING.md)       | Nx setup, file structure, `@r10c/source` resolution, every command, module boundaries, testing, and conventions.               |
| [infra/local/README.md](infra/local/README.md) | The minikube platform (MongoDB, Redis, Postgres, Zitadel, otel-lgtm).                                                          |
| [CLAUDE.md](CLAUDE.md)                         | Router guide for AI assistants — imports the shared snippets and links these docs.                                             |

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

Requires **Node 26.4** and **pnpm 11.9** (see `engines`).

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

Full command reference (build, typecheck, lint, test, e2e, affected, graph) is in [docs/DEVELOPING.md](docs/DEVELOPING.md).
