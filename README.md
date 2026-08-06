# R10c

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

Nx + pnpm monorepo for the **entifix** entity framework and the marketplace apps built on it. Everything is layered top-to-bottom and **dependencies only point downward**.

## Status (2026-08)

Active development. In place today:

- **entifix** entity framework — core, business contracts + use-cases, REST adapter, **Mongo** and **Postgres** adapters, the Redis/AMQP clients, and the React integration.
- Domains with entities: **product-configuration-management** (`Product`/`ProductBrand`/`ProductCategory`), **authn** (`UserIdentity`/`EntityIdentifier`), **party-management** (`Organization`/`Individual`) and **access-management** (`Membership`/`Role`/`Entitlement`). `marketplace-catalog`, `stock-management`, `order-management`, `payment-management` and `settlement-management` are tagged skeletons — see the [capability map](docs/BUSINESS-ARCHITECTURE.md#capability-map).
- Frontends (`marketplace-app`, `marketplace-admin-app`, `auth-app`) and Effect-native backends.
- Backends wired to real datastores: **config-service → PostgreSQL**, **marketplace-admin-service** & **auth-service → MongoDB**, seeded on first boot.

Full CRUD (`load`/`get`/`save`/`delete`) runs end-to-end over REST, Mongo and Postgres; writes go through the CQRS **transaction** facade (Redis locks + RabbitMQ events, tracked by `transaction-manager`); credential auth is real (Redis sessions + cookie-carried **RS256** JWTs, verified with a public key every service resolves from config-service) with permission-based authorization; copy is `es`/`en` through mandatory i18n. Business data is split across **three planes** and the tenant plane is live — the catalog physically lives in one Mongo database per organization, reached only through the handle the session resolves. Every session carries the population it belongs to (`partyRole`: customer / vendor / operator) rather than inferring it from a missing organization. Zitadel is still deferred ([ADR 0016](docs/adr/0016-zitadel-authenticates-r10c-authorizes.md)). Observability (OTLP → local `otel-lgtm`) is wired on the services.

## Documentation

| Doc                                                            | What's inside                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                   | Layering, the use-case + adapter mechanism, backends, auth, transactions, observability, and the domain structure.             |
| [docs/BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md) | The business the platform runs: capability map, ODA/SID glossary, personas as party roles, data planes, catalog, stock rules.  |
| [docs/ENTIFIX.md](docs/ENTIFIX.md)                             | Deep dive: how self-describing entities + Effect DI make one use-case run in any environment.                                  |
| [docs/FRONTEND.md](docs/FRONTEND.md)                           | The client side: design system (tokens, flex-first layout primitives, Storybook) and the workspace tabs + TanStack data layer. |
| [docs/I18N.md](docs/I18N.md)                                   | Locales, catalogs, locale routing, entity label keys, error codes, and the three gates that make i18n mandatory.               |
| [docs/DEVELOPING.md](docs/DEVELOPING.md)                       | Nx setup, file structure, `@r10c/source` resolution, every command, module boundaries, testing, and conventions.               |
| [docs/adr/](docs/adr/)                                         | Architecture Decision Records — Accepted ones bind, Proposed ones carry a `## Trigger` naming what promotes them.              |
| [infra/local/README.md](infra/local/README.md)                 | The minikube platform (MongoDB, Redis, Postgres, Zitadel, otel-lgtm).                                                          |
| [CLAUDE.md](CLAUDE.md)                                         | Router guide for AI assistants — imports the shared snippets and links these docs.                                             |

## Architecture at a glance

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/{next,effect}/*     ← framework shells: Next pages+adapters / the effect-service base
packages/implementation/<domain>/*  ← domain wired to a delivery mechanism (React organisms)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework (core / business / rest-client / mongo-client / sql-client / react/*)
packages/utils/ts/*                 ← generic TS helpers
```

Six tag dimensions in each project's `nx.tags` make that arrow enforceable —
`layer:`, `scope:`, `entifix:`, `business:`, `shell:` and `host:` — and
`@nx/enforce-module-boundaries` fails the build on any upward or cross-domain
edge. `host:next` may not depend on `runtime:datastore`: a Next backend is
composition (cookies, proxying, RSC aggregation), never data access.

Business data lives in one of **three planes** — **control** (parties, access,
identity, config), **platform** (published catalog, carts, orders) and **tenant**
(vendor-authored catalog, cost, stock). Entities are organization-agnostic: no
`organizationId` member and no tenant filter, because isolation is _which
database handle the request resolves to_, so no query can leak by omission. See
[docs/BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md) and
[ADR 0006](docs/adr/0006-multitenancy-planes-and-tenant-storage.md).

The framework is decorator + [Effect](https://effect.website)-based:

- **`entifix-ts-core`** — `@entity()` / `@accessor()` register metadata on `MetaEntity`; domain types (`Entity`, `EntityLoadRequest`, `EntityPage`, filtering/sorting); the shared (de)serializer; **entity links** (`EntityLink` / `EntityCollectionLink`) that model relations as either a foreign key or embedded data, resolved lazily through an `EntityLinkResolver`.
- **`entifix-ts-business`** — repository/resolver contracts + use-case factories over Effect. Repositories return `Effect<T, EntifixError>`; dependencies are injected as `Context.Tag`s.
- **`entifix-ts-rest-client`** / **`entifix-ts-mongo-client`** / **`entifix-ts-sql-client`** — turn an entity into an `EntityRepository` over HTTP (web), MongoDB or PostgreSQL (backend). The same use-case runs against any of them; only the composition root swaps the adapter.
- **`entifix-react-*`** — `controls` (UI primitives) and `integration` (Effect-aware hooks: `useDataLoading`, `useEntityLinkResolver`).

Backends are **Effect-native** (no Nest): they compose `@r10c/shells-effect-service` (`@effect/platform` HTTP + `/api/health` + `Layer` DI + graceful shutdown) and compile stage-3 like entifix, so they import entity classes natively. Frontends and backends both resolve runtime config through `config-service` (`:3190`), never hardcoded.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ENTIFIX.md](docs/ENTIFIX.md) for the full picture.

## Quickstart

Requires **Node 26.4** and **pnpm 11.9** (see `engines`).

```sh
pnpm install

# Run an app. Each one brings up local infrastructure (minikube) as needed —
# starts a stopped cluster, applies missing manifests, waits for the datastores.
pnpm run mp:dev              # marketplace-app       :3000
pnpm run mp-admin:dev        # marketplace-admin-app :3001
pnpm run auth:dev            # auth-app              :3002

# When something is wedged: recreate the datastores, then run (WIPES local data —
# including every per-organization tenant database — which re-seeds on service
# boot). `pnpm run dev-infra:doctor` diagnoses without fixing.
pnpm run mp-admin:dev:reset

# Services follow the same convention, but are dependencies of an app's `dev`
# rather than entry points.
pnpm nx run config-service:dev             # :3190 (Postgres)
pnpm nx run marketplace-admin-service:dev  # :3101 (Mongo)
pnpm nx run auth-service:dev               # :3102 (Mongo)
```

Full command reference (build, typecheck, lint, test, e2e, affected, graph) is in [docs/DEVELOPING.md](docs/DEVELOPING.md).
