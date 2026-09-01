# R10c

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

Nx + pnpm monorepo for the **entifix** entity framework and the marketplace apps built on it. Everything is layered top-to-bottom and **dependencies only point downward**.

## Status (2026-08)

Active development. In place today:

- **entifix** entity framework — core, business contracts + use-cases, REST adapter, **Mongo** and **Postgres** adapters, the Redis/AMQP clients, and the React integration.
- **11 domains, 28 entities** ([ADR 0022](docs/adr/0022-v1-marketplace-module-boundaries.md) locked the v1 boundaries): **product-configuration-management** (`ProductOffering`/`ProductOfferingPrice`/`ProductSpecification`/`EntitySpecification`/`CharacteristicSpecification`), **catalog-reference** (`ProductBrand`/`ProductCategory`/`DictionaryTerm` — platform-plane, because a marketplace has to merge taxonomy and per-vendor taxonomy cannot), **marketplace-catalog** (`PublishedOffering`), **authn** (`UserIdentity`/`EntityIdentifier`/`UserDevice`), **party-management** (`Organization`/`Individual`/`PartyRole`), **access-management** (`Membership`/`Role`/`Entitlement`), **stock-management** (`StockItem`/`Reservation`/`StockMovement`), **order-management** (`ProductOrder`), **payment-management** (`Payment`), **settlement-management** (`Agreement`/`SettlementRun`/`CommissionEntry`/`VendorPayout`) and **config** (`Configuration`). See the [capability map](docs/BUSINESS-ARCHITECTURE.md#capability-map).
- **Six deployments**, two of them frontends: `marketplace-app` and `back-office-app` (which mounts the catalog, system-management, user-administration and account shells at one origin), plus `config-service`, `marketplace-admin-service` (co-deploying the `transaction` slice), `auth-service` and `marketplace-service`. The `stock`, `order`, `payment` and `settlement` slices own their stores in the register but are **planned** — no process runs them yet.
- Backends wired to real datastores: **config-service → PostgreSQL**, **marketplace-admin-service**, **auth-service** & **marketplace-service → MongoDB**, seeded on first boot.

Full CRUD (`load`/`get`/`save`/`delete`) runs end-to-end over REST, Mongo and Postgres; writes go through the CQRS **transaction** facade (Redis locks + RabbitMQ events, tracked by the co-deployed saga tracker); authentication is **Zitadel** (authorization code + PKCE against its hosted UI; r10c stores no password, and MFA and social sign-in are configuration) while r10c keeps its own Redis sessions and cookie-carried **RS256** JWTs, verified with a public key every service resolves from config-service, with permission-based authorization; copy is `es`/`en` through mandatory i18n. Business data is split across **three planes** and the tenant plane is live — the catalog physically lives in one Mongo database per organization, reached only through the handle the session resolves. Every session carries the population it belongs to (`partyRole`: customer / vendor / operator) rather than inferring it from a missing organization. Observability (OTLP → local `otel-lgtm`) is wired on the services.

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
| [infra/local/README.md](infra/local/README.md)                 | The minikube platform (MongoDB, Redis, RabbitMQ, Postgres, Zitadel, Mailpit, otel-lgtm).                                       |
| [CLAUDE.md](CLAUDE.md)                                         | Router guide for AI assistants — imports the shared snippets and links these docs.                                             |

## Architecture at a glance

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/{next,effect}/*     ← framework shells: Next pages+adapters / the effect-service base
packages/implementation/<domain>/*  ← domain wired to a delivery mechanism (currently unpopulated)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework (core / business / rest-client / mongo-client / sql-client / react/*)
packages/utils/ts/*                 ← generic TS helpers
```

Six tag dimensions in each project's `nx.tags` make that arrow enforceable —
`layer:`, `scope:`, `entifix:`, `business:`, `shell:` and `host:` — and
`@nx/enforce-module-boundaries` fails the build on any upward or cross-domain
edge. `host:next` may not depend on `runtime:datastore`: a Next backend is
composition (cookies, proxying, RSC aggregation), never data access.

Business data lives in a **Store**, a Store belongs to a **Slice**, and a Store
sits in one of **three planes** — **control** (parties, access, identity, config,
agreements and payouts), **platform** (the published catalog, the
brand/category/dictionary vocabulary, buyer orders and payments) and **tenant**
(vendor-authored offerings and specifications, pricing, stock). `Domain → Store →
Slice → Deployment`: a domain's entities live in exactly one Store, a Store has
exactly one writing Slice, and the register in
[docs/\_shared/planes.md](docs/_shared/planes.md) is a mirror of
`tools/slices/`, which fails the build on drift. Entities are
organization-agnostic: no
`organizationId` member and no tenant filter, because isolation is _which
database handle the request resolves to_, so no query can leak by omission. See
[docs/BUSINESS-ARCHITECTURE.md](docs/BUSINESS-ARCHITECTURE.md),
[ADR 0006](docs/adr/0006-multitenancy-planes-and-tenant-storage.md) and
[ADR 0020](docs/adr/0020-stores-and-slices.md).

The framework is decorator + [Effect](https://effect.website)-based:

- **`entifix-ts-core`** — `@entity()` / `@accessor()` register metadata on `MetaEntity`; domain types (`Entity`, `EntityLoadRequest`, `EntityPage`, filtering/sorting); the shared (de)serializer; **entity links** (`EntityLink` / `EntityCollectionLink`) that model relations as either a foreign key or embedded data, resolved lazily through an `EntityLinkResolver`.
- **`entifix-ts-business`** — repository/resolver contracts + use-case factories over Effect. Repositories return `Effect<T, EntifixError>`; dependencies are injected as `Context.Tag`s.
- **`entifix-ts-rest-client`** / **`entifix-ts-mongo-client`** / **`entifix-ts-sql-client`** — turn an entity into an `EntityRepository` over HTTP (web), MongoDB or PostgreSQL (backend). The same use-case runs against any of them; only the composition root swaps the adapter.
- **`entifix-react-*`** — `controls` (UI primitives) and `integration` (Effect-aware hooks: `useDataLoading`, `useEntityLinkResolver`).

Backends are **Effect-native** (no Nest): they compose `@r10c/shells-effect-service` (`@effect/platform` HTTP + `/api/health{,/live,/ready}` + `Layer` DI + graceful shutdown) and compile stage-3 like entifix, so they import entity classes natively. Frontends and backends both resolve runtime config through `config-service` (`:3190`), never hardcoded.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ENTIFIX.md](docs/ENTIFIX.md) for the full picture.

## Quickstart

Requires **Node 26.4** and **pnpm 11.9** (see `engines`).

```sh
pnpm install

# Run an app. Each one brings up local infrastructure (minikube) as needed —
# starts a stopped cluster, applies missing manifests, waits for the datastores.
pnpm run mp:dev              # marketplace-app       :3000
pnpm run back-office:dev     # back-office-app       :3001

# When something is wedged: recreate the datastores, then run (WIPES local data —
# including every per-organization tenant database — which re-seeds on service
# boot). `pnpm run dev-infra:doctor` diagnoses without fixing.
pnpm run back-office:dev:reset

# Services follow the same convention, but are dependencies of an app's `dev`
# rather than entry points.
pnpm nx run config-service:dev             # :3190 (Postgres)
pnpm nx run marketplace-admin-service:dev  # :3101 (Mongo)
pnpm nx run auth-service:dev               # :3102 (Mongo)
```

Full command reference (build, typecheck, lint, test, e2e, affected, graph) is in [docs/DEVELOPING.md](docs/DEVELOPING.md).
