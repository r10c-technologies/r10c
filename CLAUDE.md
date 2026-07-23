# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deeper docs live in [`docs/`](docs/): [ARCHITECTURE](docs/ARCHITECTURE.md) (layering, use-case + adapter mechanism, domain structure), [ENTIFIX](docs/ENTIFIX.md) (how entities + Effect DI make use-cases agnostic), [WORKSPACE](docs/WORKSPACE.md) (Nx, file layout, commands), [CONTRIBUTE](docs/CONTRIBUTE.md) (conventions). This file is the condensed version — prefer editing `docs/` for prose and keep this in sync.

## Tooling

Nx 23 monorepo with pnpm workspaces. Pinned versions: **Node 26.4**, **pnpm 11.9** (see `engines` in root `package.json`). Always use `pnpm` (not `npm`/`yarn`) and run Nx via `pnpm nx ...` (or `pnpm exec nx`).

## Common commands

```sh
# Unified dev convention for EVERY app/service: `pnpm nx run <artifact>:dev`
# (each artifact starts its own dependencies).

# Next.js apps (ports pinned: app 300N)
pnpm nx run marketplace-app:dev          # :3000
pnpm nx run marketplace-admin-app:dev    # :3001 (auto-starts marketplace-admin-service + config-service)
pnpm nx run auth-app:dev                 # :3002

# Effect-native services (build + node; port 310N / 319x). Backend `dev` first
# runs `ensure-infra` (infra/local/ensure.sh — needs minikube up with the infra
# datastores); the Mongo services also start config-service (their config source).
pnpm nx run marketplace-service:dev        # :3100
pnpm nx run marketplace-admin-service:dev  # :3101 (Mongo; +config-service)
pnpm nx run auth-service:dev               # :3102 (Mongo; +config-service)
pnpm nx run transaction-manager:dev        # :3103 (Mongo + RabbitMQ; passive saga tracker)
pnpm nx run config-service:dev             # :3190 (Postgres)

# Build / typecheck / lint a single project
pnpm nx build <project>
pnpm nx typecheck <project>
pnpm nx lint <project>

# Tests (Vitest, inferred target `test`)
pnpm nx test <project>                        # all tests in one project
pnpm nx test <project> -- <pattern>           # single test by name/file pattern
pnpm nx test <project> -- --watch
pnpm nx test <project> --coverage             # every packages/* project is gated at 100%
pnpm nx run-many -t test --coverage           # the whole gate

# E2E (Playwright for Next apps, Vitest for services).
# E2E_PROFILE=mock is the DEFAULT and is hermetic — no infra, runs on every PR.
pnpm nx e2e marketplace-admin-app-e2e
pnpm nx e2e marketplace-admin-service-e2e

# The same journeys against real infrastructure (start the service first):
E2E_PROFILE=live MARKETPLACE_ADMIN_SERVICE_URL=http://localhost:3101 \
  pnpm nx e2e marketplace-admin-app-e2e

# Affected-only (what the pre-commit hook also runs against origin/main)
pnpm nx affected -t lint,build,test
pnpm nx affected -t lint,build --base=origin/main --head=HEAD

# Run a target across every project
pnpm nx run-many -t build
pnpm nx run-many -t typecheck

# Discover targets / explore the graph
pnpm nx show project <project>
pnpm nx graph

# Local registry for testing publishes
pnpm nx local-registry
```

Project names are scoped (`@r10c/<name>`) but Nx accepts the unscoped suffix for most commands (e.g. `marketplace-app`, `entifix-ts-core`). When in doubt, run `pnpm nx show projects`.

## Pre-commit / commit conventions

`.husky/pre-commit` runs `lint-staged` (formats staged files via `pnpm nx affected --target=format --files`) and then `pnpm nx affected --target=lint,build --base=origin/main --head=HEAD`. It first runs `git fetch --all -p`, so origin must be reachable.

Commits must follow Conventional Commits with Nx scopes (`@commitlint/config-nx-scopes`). The scope is the project name (e.g. `feat(entifix-ts-core): ...`).

## Architecture

The repo is layered top-to-bottom; **dependencies only point downward**. Library names in package.json are `@r10c/<area>-<lang>-<name>` and that name encodes the layer.

```
apps/                               ← runtime hosts (Next.js frontends / Effect services)
  shells/{next,effect}/*            ← framework shells (Next pages+adapters / the effect-service base)
  implementation/<domain>/react     ← domain wired to a delivery mechanism (React UI organisms)
  business/ts/<domain>              ← pure domain entities & use-cases (no framework)
  entifix/{ts,react}/*              ← in-house entity framework (core / business / rest-client / react/*)
                                      + platform tooling (tooling: logging/tracking, posthog-client)
  utils/ts/*                        ← generic TS helpers (array, date, object, type)
```

### Entifix — the entity framework

`@r10c/entifix-ts-core` provides a decorator-based entity model:

- `@entity()` registers a class on `MetaEntity`; `@accessor()` / `@method()` register members. `MetaEntity.extract(Ctor)` returns the metadata used by adapters/UCs.
- Domain types live under `types/` (`Entity`, `EntityId`, `EntityLoadRequest`, `EntityPage`, `EntityFiltering`, `EntitySorting`).

`@r10c/entifix-ts-business` defines the _contracts_ and the **use-case factories** built on the [Effect](https://effect.website) library:

- `EntityRepository` interface + `EntityRepositoryTag` (`Context.Tag`) — repositories return `Effect<T, EntifixError>`.
- `*UCFactory()` (`load`, `get`, `save`, `delete`) returns an `Effect.gen` that yields the `EntityRepositoryTag` plus any input tags (e.g. `EntityIdTag`, `EntityLoadRequestTag`). Implementations provide these tags via `Effect.provide` at call time. Use-cases never import frameworks.

`@r10c/entifix-ts-rest-client` converts an `EntityConstructor` into an `EntityRepository` over HTTP via the `buildEntityRestAdapter*` builders — used by Next shells to back the `EntityRepositoryTag` on the client. The load/get adapters build the endpoint from the entity's **`key`** (`metaEntity.key ?? metaEntity.name`), so keep entity `key`s in kebab-case matching the REST routes.

`@r10c/entifix-ts-mongo-client` is the server-side mirror: `makeMongoRepository(db, Ctor)` returns an `EntityRepository` backed by MongoDB (collection = the entity `key`), with `MongoDatabaseTag`/`MongoDatabaseLayer` for the connection, a `filter-translator` (`EntityFiltering`/`EntitySorting`/pagination → Mongo query), and `makeMongoLinkResolver` for backend link resolution. The shared entity (de)serializer lives in `entifix-ts-core` (`serializeEntity`/`deserializeSingleEntity`) so REST and Mongo adapters round-trip the same wire shape. Backends run the SAME `*UCFactory` use-cases against this adapter, then `serializeEntity`/`serializeEntityCollection` the result for the HTTP response.

`@r10c/entifix-transactions` layers CQRS transactions on top: a write (`POST`) becomes a _command_ run through a five-step facade — validate → lock → execute → rollback → free — each step a `*UCFactory` in the same `Effect.gen` + Context.Tag style. The `runTransaction` engine splits at the `202` boundary: `acceptTransaction` (validate + lock) is synchronous (failure → `400`/`409`), `completeTransaction` (execute + free, or rollback + free) is forked past the `202` and publishes lifecycle events. Ports (`LockService`/`SequenceService`/`EventBus`/`TransactionStore`/`TransactionHandler`) are framework-free; transports mirror the entity adapters — `@r10c/entifix-ts-redis-client` (lock via `SET NX`, sequences via atomic `INCR`) and `@r10c/entifix-ts-amqp-client` (RabbitMQ fanout bus). It is **choreography**: services own their transactions and emit events; the `transaction-manager` service (`:3103`, Mongo + RabbitMQ) is a **passive** tracker (subscribe → record → recover), never a dispatcher. The `EntifixEnvelope` carries commands/events (`meta.type` `'command'`/`'transactionEvent'`). See [[entifix-transactions-phase1]] and `docs/ARCHITECTURE.md`.

`@r10c/entifix-react-controls` / `-integration` are the React side: UI components and Effect-aware hooks (`useDataLoading({ uc, ctx })`, `useEntityLinkResolver(...)`) that run a UC factory against an adapter context. (There is no `entifix-react-helpers` — it was a duplicate and was removed; use `-integration`.)

`@r10c/entifix-ts-tooling` is the framework-free **platform tooling** leaf (built on the OpenTelemetry standard, NOT an Effect wrap — so the browser/Next server can use it too). Two subpath modules: `/logging` (`createLogger({ service, level, sink, redact })` over a pluggable `LogSink`; stamps service + `SeverityNumber` + active `trace_id`/`span_id`; sinks `makeStdoutJsonSink`/`makeOtlpHttpLogSink`) and `/tracking` (the `Tracker` interface + `NoopTracker`). `@r10c/entifix-ts-posthog-client` adapts PostHog (`posthog-node` + `posthog-js`/`browser`) to `Tracker`, provided per environment behind `TrackerTag` — product analytics is a SEPARATE concern from logs, never routed into Loki/OTel. **Don't wrap OTel in a Context.Tag** (cross-cutting, already vendor-neutral); DO wrap the analytics SDK. See [ADR 0001](docs/adr/0001-observability-and-tooling.md) and [[observability-stack-decision]].

#### Metadata-driven UI (`EntityTable` + UI preferences)

`@accessor()` carries presentation metadata alongside the wire metadata: `type` (`MetaAccessorType`: `string | number | boolean | date | enum | id | link | linkCollection`), `label`, `sortable`, `filterable`, `order`, `enumValues`, `linkLabelProperty`. `describeEntityColumns(Ctor, sample?)` (core) resolves them into `EntityFieldDescriptor[]` — declared wins, otherwise the type is inferred from a sample row and the label is humanized; `sortable`/`filterable` default on for scalars and off for `id`/links. Annotate new entities (see the catalog entities for the pattern).

`EntityTable` (controls, organism) builds a whole listing from that: columns, labels, and per-type value rendering (`CellValue`). It also owns column **personalization** (order/visibility) persisted through the `UiPreferencesStore` port, a CSS-only **columns-to-rows pivot** below `pivotBreakpoint` (default `md` — both layouts render, CSS picks one, so there is no SSR hydration mismatch), and declarative **slots** (`EntityColumn`, `EntityTableHeader`, `EntityTableRow`, `EntityTableToolbar`) matched by component identity. The filter/sort panels emit `FilterGroup`/`EntitySorting` via `onFilteringChange`/`onSortingChange` — **on Apply, not per keystroke** (each emission is an HTTP round trip) — and `useDataLoading` puts them in the `EntityLoadRequest`, resetting to page 1 on every change.

#### RSQL query protocol

Filtering/sorting travel as query parameters via the codec in `entifix-ts-core` (`src/rsql/`): `?rsql=name=like=Acme;stock=gt=10` (RSQL — `;` and, `,` or, `(…)` groups, extensions `=in= =out= =btn= =nbtn= =like= =nlike= =isnull=`) plus `?sort=+name,-code` (sign = direction, position = precedence). It lives in `core` because both transports need it: `buildEntityRestAdapterLoad` calls `serializeLoadRequestParams`, a service calls `parseLoadRequestParams(Ctor, search)`, and the mongo-client's `filter-translator` finishes the job unchanged. Values go out **untyped** (quoted strings, bare numbers/booleans, ISO dates); `coerceFiltering`/`parseSort` re-type them from `describeEntityColumns(Ctor)` and reject anything that is not a `filterable`/`sortable` member with `EntifixBuildError` → `400`. That allowlist is the trust boundary — a member without the right metadata cannot be queried at all. See `docs/ENTIFIX.md` §6.

`UiPreferencesStore` (`controls/src/preferences/`) is the general per-user UI-state seam, not table-specific: `read`/`write`/`remove` returning `Effect`s, `UiPreferencesStoreTag`, `makeLocalStorageUiPreferencesStore(namespace)` + `LocalStorageUiPreferencesLayer`, `UiPreferencesProvider`, `useUiPreference(key, fallback)`. Keys are `<namespace>:<component>:<scope>` (`r10c-ui:entity-table:product`). It is async-capable on purpose so a server-backed store swaps in at the provider. Note: decorators are compiled stage-3 by `unplugin-swc` in `vitest.shared.mts` so specs can define entities, and `vitest.setup.dom.ts` polyfills `TextEncoder`/`TextDecoder`/`localStorage` (jsdom lacks them, `effect` imports them).

#### Entity links (relations)

`EntityLink<T>` / `EntityCollectionLink<T>` (in `entifix-ts-core` under `entity-definition/links`) model a relation that a raw payload can express two ways:

- **foreign key** — only the id arrived; the target is fetched lazily.
- **embedded** — the target arrived inline and was deserialized into an instance (`isLoaded`).

Declare a link as a `#field` initialized in the constructor (`new EntityLink(TargetCtor)`) with an `@accessor()` getter (no setter — links are read-only accessors). The rest-client deserializer detects these pre-initialized link instances and populates them from the raw value (object → embedded instance, scalar → foreign-key id) instead of assigning through a setter.

Resolution is an Effect that requires a resolver, injected so it stays environment-agnostic:

- `EntityLinkResolver` (core, framework-free interface) → `EntityLinkResolverTag` (business, `Context.Tag`).
- `link.reload(resolver)` / `link.resolve(resolver)` return `Effect<T, EntifixError>`.
- A load use-case that follows links yields `EntityLinkResolverTag` and reloads any not-yet-loaded link (see `business/ts/product-configuration-management/.../load-products.uc.ts`).
- The composition root builds the resolver from existing repository adapters — on the client via `useEntityLinkResolver(configStore, [[Ctor, repoCtx], …])` at the **page** level (the seam for cache/state-backed adapters later). Swapping REST for Mongo means only swapping what the resolver's adapters point at; the use-case is untouched.

> Layering note: `core` cannot import `business`, so `EntityLink.reload` takes the resolver as an argument (core interface) rather than reading a business Tag. In a Rollup-bundled shell, any package whose runtime values you import must be in the rollup `external` list — `entifix-ts-core` is included there.

### Design system & layout primitives

The agnostic UI kit is `@r10c/entifix-react-controls` (`ui/atoms`, `ui/molecules`, `ui/layout`, `ui/organisms`); styling tokens live in the CSS-only `@r10c/entifix-style` (`tokens.css` = Utopia fluid `--spacing-*`/`--text-step-*`, the layout tokens `--measure`/`--grid-min`, and the semantic colour contract). **Layout is flex-first** (Every Layout): `ui/layout/` primitives — `Box`, `Center`, `Cluster`, `Sidebar`, `Switcher`, `Cover`, `Grid` (+ `Stack` in molecules) — lay themselves out intrinsically via `flex-wrap`/`flex-basis`/`gap`, **no media queries**; `Grid` is the single CSS-Grid escape hatch for card grids. Conventions (locked): polymorphic `as`, gap/padding as token-key unions → `--spacing-*`, dynamic dimensions as an inline `--_var` consumed by a **static** arbitrary-value class (`basis-[var(--_side-width,20rem)]`), region primitives (Sidebar/Cover) as compound components, flat named exports, static Tailwind class strings only. **Page shells compose primitives and live in the Next shells, not here** — the back-office shell (`@r10c/shells-next-common`, `src/lib/back-office/`: strong collapsible sidebar persisted via `UiPreferencesStore` + path-derived breadcrumbs) is adopted by `marketplace-admin-app` via a `(back-office)` route group. Component docs are an **agnostic-only Storybook** (SB10 + React-Vite) hosted in the controls package (`pnpm nx run entifix-react-controls:storybook`, `:6006`), reproducing the Tailwind-v4 + `@r10c/source` pipeline with a `data-theme` theme toolbar; stories/`_demo` are coverage-excluded and must not instantiate decorated entities. Full conventions + the new-component checklist: [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md). See [[design-system-theme]] and [[layout-primitives-decision]].

### Composition flow (concrete example)

`ProductCategory` (business) → `ProductCategoryTable` organism (implementation/react) → `ProductCategoryListClientPage` (shells/next/marketplace-admin) → `marketplace-admin-app` (Next.js app).

The shell calls `loadUCFactory<ProductCategory>()` from `entifix-ts-business`, pulls the REST-backed `productCategoryRest` adapter from `MarketplaceAdminContext`, and hands both to the organism, which uses `useDataLoading` to run the Effect.

The `Product` flow additionally exercises links: `loadProductsUCFactory()` → `ProductTable` (renders resolved `brand`/`category`) → `ProductListClientPage` (wires `productRest` + `useEntityLinkResolver([[ProductBrand, productBrandRest], [ProductCategory, productCategoryRest]])`) → `/catalog/product`. The three catalog pages (`product`, `product-brand`, `product-category`) share `app/catalog/layout.tsx` (nav bar) and are backed by `marketplace-admin-service` (:3101, seed catalog data; product `brand` embedded, `category` a foreign key).

When adding a new domain entity, the layered path is: define the entity in `business/ts/<domain>` (decorate with `@entity`/`@accessor` including `type`/`label`, model relations with `EntityLink`), then build the UI organism in `implementation/<domain>/react` (usually a thin `EntityTable` wrapper — only reach for slots when the metadata cannot express the presentation), wire the page in `shells/next/<shell>`, and register the adapter (and any link resolver registrations) in the shell.

### Workspace resolution: `@r10c/source` condition

`tsconfig.base.json` sets `customConditions: ['@r10c/source']`, and every workspace library's `package.json` has:

```json
"exports": { ".": { "@r10c/source": "./src/index.ts", "import": "./dist/index.esm.js", ... } }
```

So **inside the workspace, imports resolve to each package's `src/index.ts`** — no rebuild needed between dependent libraries during dev/typecheck. External consumers get the built `dist/`. When adding a new library, mirror this `exports` shape or cross-package imports won't resolve in dev.

Library builds use `@nx/js:swc` (TS-only libs, e.g. `business-ts-product-configuration-management`) or **Rollup** (React libs that ship `.esm.js` bundles, e.g. `entifix-react-*`, `shells-next-*`). Type declarations come from the inferred `@nx/js/typescript` `build`/`typecheck` targets driven by each project's `tsconfig.lib.json` (composite project references; root `tsconfig.json` lists every member).

### Apps

Frontends are Next.js (App Router, React 19, Tailwind); backends are **Effect-native** services built on the shared `@r10c/shells-effect-service` base (`@effect/platform` HTTP server, `/api/health`, `Layer`/`ManagedRuntime` DI, graceful shutdown). There is **no Nest**: DI is Effect Layers, so a missing dependency is a compile error. Backends compile stage-3 (matching entifix), so they import entity classes natively — see [[node-service-consuming-entifix-libs]].

- Frontends (`-app`): `marketplace-app`, `marketplace-admin-app`, `auth-app`.
- Backends (`-service`): `marketplace-service`, `marketplace-admin-service`, `auth-service`, plus the cross-cutting `config-service`. The deployable ones keep the explicit webpack `build` + `prune-lockfile` / `copy-workspace-modules` / `prune` targets.
- `*-e2e` projects use Playwright for Next apps and Vitest for services, both driven by `@r10c/entifix-ts-testing-e2e` and its **`E2E_PROFILE`** (`mock` — the default, hermetic, what CI runs; `live` — real infra). `mock` is not a stub of the answers: an app suite talks to msw handlers (`@msw/playwright`, over `page.route()` — nothing added to the app bundle) backed by the production query pipeline (`parseLoadRequestParams` → `loadUCFactory` → `makeMongoRepository` → fake Mongo driver), and a service suite boots the service's REAL router via `serveTestService` (`shells-effect-service`) on an ephemeral port with only the connection Layers faked. So both profiles agree on filtering/sorting/paging and the allowlist `400`, and ONE spec suite serves both. Profile selection is by **filename** (`*.spec.ts` runs in both, `*.mock.spec.ts` / `*.live.spec.ts` in one) enforced by `testIgnore`/`exclude`, never by an in-spec `skip`. See `packages/entifix/ts/testing-e2e/README.md` and `docs/CONTRIBUTE.md`.

#### App & port convention

`-app` frontends bind **300N**; `-service` backends bind **310N**; cross-cutting/platform services use **319x**. The domain index `N` is shared across a frontend/backend pair. Both frontends and backends resolve their runtime config through `config-service` (`GET /api/config/:service` → `ConfigurationPlain`); they never hardcode it. config-service stores config in **PostgreSQL** (the `configuration` table: `service`/`group_name`/`key`/`value`, migrated + seeded on first boot); the Mongo services (`marketplace-admin-service`, `auth-service`) fetch their `mongo.uri`/`mongo.db` from it at boot via `loadRemoteConfiguration` (`@r10c/shells-effect-service`). Every service also exposes `GET /api/config` returning its own loaded parameters (credentials redacted). Infra (see `infra/local`) exposes minikube NodePorts at `30000 +` the service's canonical port; backend `dev` targets run `infra/local/ensure.sh` first.

| Domain (`N`)            | `-app` | `-service`          |
| ----------------------- | ------ | ------------------- |
| marketplace (0)         | 3000   | 3100                |
| marketplace-admin (1)   | 3001   | 3101                |
| auth (2)                | 3002   | 3102                |
| transaction-manager (3) | —      | 3103                |
| — platform —            |        | config-service 3190 |

Adding a domain = next index → `300N` / `310N`, plus a seed row in `config-service`'s `configuration` table (`apps/config-service/src/db.ts`).

### Local infrastructure (`infra/local`)

Minikube platform (MongoDB, Redis, PostgreSQL, Zitadel, and **`otel-lgtm`**) as per-platform kustomize folders. Postgres exists to back **Zitadel** (which requires it). `otel-lgtm` (`grafana/otel-lgtm`: Collector + Loki + Grafana + Tempo + Prometheus) is the local mirror of Grafana Cloud — Grafana at NodePort `30000`, OTLP at `30317`/`30318`. Host-run `dev` services export telemetry straight to `http://127.0.0.1:30318` (there is no pod to tail). Secrets are never committed: a kustomize `secretGenerator` reads a git-ignored `.env` (committed `.env.example` holds LOCAL DEV ONLY defaults); `infra/local/apply.sh` generates the Zitadel master key. Bring it up with `minikube start --ports …` then `infra/local/apply.sh`.

## Notes for code changes

- The Nx ESLint rule `@nx/enforce-module-boundaries` is on; don't introduce upward dependencies (e.g. an `entifix` package importing from `business` or `shells`).
- Effect/Context tags are the dependency-injection mechanism — wire new dependencies as `Context.Tag` subclasses rather than passing instances through constructors.
- Private fields on entities use `#name` syntax with `@accessor()`-decorated getters/setters; follow that pattern when adding entity members so MetaEntity introspection works. Pass `type`/`label` (and `sortable`/`filterable`/`hidden` where they differ from the defaults) so generic UI does not have to guess — see [Metadata-driven UI](#metadata-driven-ui-entitytable--ui-preferences). A member's `filterable`/`sortable` metadata is also the **server-side allowlist**: a query naming a member that lacks it is rejected with a `400`, so making a member queryable is a one-line change on the entity and nowhere else.
- **Adding a filter operator** means touching three places or it half-works: the const arrays in `core/types/EntityFiltering.ts`, the token map in `core/src/rsql/rsql-operators.ts`, and `mongo-client`'s `filter-translator.ts`. The core round-trip spec (`serialize → parse → coerce` equals the original) is what catches a partial addition.
- **Backend DB adapters**: a `-service` backing entities with a datastore provides `EntityRepositoryTag` from `makeMongoRepository(db, Ctor)` (`entifix-ts-mongo-client`) and runs the SAME `*UCFactory` use-cases, then `serializeEntity`/`serializeEntityCollection` for the response. Gotchas: (a) add the native driver (`mongodb`, `@effect/sql*`) to the service's `webpack.config.js` `externalDependencies` and keep `tslib` external; (b) `@effect/sql`/`@effect/sql-pg` must match the pinned `@effect/platform` (0.96.2 → `@effect/sql@0.51.1` + `@effect/sql-pg@0.51.0`, which bundles `pg`) or `pnpm install` breaks; (c) `makeMongoRepository` closures give each method `R = never` (assignable to the interface's `ConfigurationRepositoryTag`); (d) resolve DB connection settings from config-service at boot via `loadRemoteConfiguration` — don't hardcode. See [[backend-db-connectivity]] and `docs/ENTIFIX.md`.
- Services read cross-service config from **config-service** (Postgres, `configuration` table seeded in `apps/config-service/src/db.ts`); every service also exposes `GET /api/config` (own params, credentials redacted via `redactConfiguration`).
- **Transactions**: a `-service` with transactional writes provides the transaction ports from the Redis/AMQP layers (`RedisLayer` + `RedisLockServiceLayer`/`RedisSequenceServiceLayer`, `AmqpLayer` + `AmqpEventBusLayer`) in its `AppLayer`, and resolves `redis.uri`/`rabbitmq.uri` from config-service; add `ioredis`/`amqplib` to `externalDependencies`. The domain half is a `TransactionHandler` closing over its deps (so methods are `R = never`, like `makeMongoRepository`). Gotchas surfaced live: the manager's event fold needs AMQP `prefetch(1)` **and** a unique index on `transactionId` or `accepted`/`completed` events race into duplicate records; `markStale` must filter on non-terminal state; `seedCatalog` is not idempotent across concurrent instances. See [[entifix-transactions-phase1]].
- **Auth (sessions + tokens)**: auth-service owns `register`/`login`/`logout`/`refresh` — credential UCs in `business-ts-authn` over `AccountRepositoryTag`/`PasswordHasherTag` (Mongo + bcrypt), then a shared `establishSession` mints a revocable Redis session (`SessionStoreTag`, `entifix-ts-redis-client`) and a short-lived HS256 access token (`TokenServiceTag`, `entifix-ts-jwt-client`, jose-backed). auth-service returns JSON only; each `-app` turns that into its own `r10c_sid`/`r10c_at` httpOnly cookies (`src/lib/session.ts` + `app/api/auth/*` route handlers) and a `middleware.ts` presence check. A backend that authorizes a request (e.g. marketplace-admin-service's `requirePrincipal`) verifies `r10c_at` statelessly via `TokenServiceTag` — no Redis/auth-service round trip on the hot path. See [Auth: sessions + tokens](docs/ARCHITECTURE.md#auth-sessions--tokens) and [[auth-layer-v1]].
- **Observability**: a `-service` merges an observability layer into its `AppLayer` that replaces Effect's default logger with the `@r10c/entifix-ts-tooling` logger and stands up the `@effect/opentelemetry` NodeSdk tracer, reading `logging.level`/`logging.sink`/`otel.endpoint` from config-service (`marketplace-admin-service/src/observability.ts` is the reference). Gotchas the reference handles: add the OTel packages to `externalDependencies`; register `AsyncLocalStorageContextManager` (`@effect/opentelemetry` doesn't, so the logger's active-span lookup would be empty); `makeService` passes `disablePrettyLogger: true` to `runMain` (it otherwise swaps `defaultLogger` for `prettyLoggerDefault` before the app layer runs, defeating `Logger.replace`); the tests inline OTel packages + drop the `module` resolve condition in `vitest.shared.mts` (OTel ESM uses extensionless/directory imports Node rejects). Assert emitted telemetry via `makeInMemoryObservabilityLayer` in a `*.mock.spec.ts`. See [ADR 0001](docs/adr/0001-observability-and-tooling.md) and [[observability-stack-decision]].
