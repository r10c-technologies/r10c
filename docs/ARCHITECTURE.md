# Architecture

> **Status (2026-07)** — Layered monorepo in active development. The entity
> framework (entifix), the product-catalog and authn domains, the Next.js
> frontends, and the Effect-native backends are all in place. Backends are now
> wired to real datastores: **config-service → PostgreSQL**, **marketplace-admin-service**
> and **auth-service → MongoDB**. **Full CRUD** runs end-to-end for the
> marketplace-admin catalog: `load`/`get`/`save`/`delete` over REST on the web and
> Mongo on the backend, with every message framed as an
> [EntifixEnvelope](./ENTIFIX.md#6-the-envelope-is-the-message). auth-service is
> still on the pre-envelope wire shape for its `UserIdentity`/`EntityIdentifier`
> reads (no client consumes it through the REST adapters), but its credential
> flow is real: Redis-backed sessions + short-lived HS256 JWTs (see
> [Auth: sessions + tokens](#auth-sessions--tokens) below). Zitadel/RS256/ABAC
> are still deferred.

## Layering

The repo is layered top-to-bottom and **dependencies only point downward**. A
package's name encodes its layer (`@r10c/<area>-<lang>-<name>`), and the Nx
ESLint rule `@nx/enforce-module-boundaries` forbids upward edges.

```
apps/                               ← runtime hosts (Next.js frontends / Effect-native services)
packages/shells/{next,effect}/*     ← framework shells: Next pages+adapters / the effect-service base
packages/implementation/<domain>/*  ← a domain wired to a delivery mechanism (React organisms)
packages/business/ts/<domain>       ← pure domain entities & use-cases (no framework)
packages/entifix/{ts,react}/*       ← the entity framework (core / business / rest-client / mongo-client / react/*)
packages/utils/ts/*                 ← generic TS helpers
```

The value of the layering is substitutability: a use-case in `business` depends
only on contracts (`entifix-ts-business`), never on a transport. The same
use-case runs on the web against a REST adapter and on a backend against a Mongo
adapter, because the transport is injected at the composition root.

## The use-case + adapter mechanism

The core idea is **environment-agnostic use-cases**, wired with the
[Effect](https://effect.website) library's dependency injection (`Context.Tag` +
`Layer`).

1. **Contract** — `EntityRepository` (in `entifix-ts-business`) declares
   `get` / `load` / `save` / `delete`, each returning `Effect<T, EntifixError, …>`.
   It is exposed as a `Context.Tag` — `EntityRepositoryTag`.

2. **Use-case** — all four are factories (`loadUCFactory<T>()`, `getUCFactory<T>()`,
   `saveUCFactory<T>()`, `deleteUCFactory<T>()`) returning an `Effect.gen` that
   _yields_ the tags it needs — `EntityRepositoryTag` plus a per-call input tag
   (`EntityLoadRequestTag`, `EntityIdTag`, `EntityTag`), and for link-following
   loads `EntityLinkResolverTag`. They import **no framework and no transport** —
   only contracts and Effect. The type parameter is what lets a caller get a
   typed entity back: the input tags carry no entity type of their own.

3. **Adapter** — a concrete `EntityRepository`:
   - `entifix-ts-rest-client` — `buildEntityRestAdapter*` over HTTP (the web).
   - `entifix-ts-mongo-client` — `makeMongoRepository(db, Ctor)` over MongoDB
     (the backend). Collection/endpoint name = the entity's `key`.

   Both ends of a _read_ share one wire format for filtering and sorting: the
   **RSQL codec** in `entifix-ts-core` (`?rsql=` + `?sort=`). It lives in `core`
   rather than in either adapter because both sides need it — the REST client
   serializes an `EntityLoadRequest` into it, a service parses one back out and
   validates it against the entity's metadata, and only then does the Mongo
   adapter's `filter-translator` turn it into a query. See
   [ENTIFIX §6](ENTIFIX.md#6-the-rsql-query-protocol).

4. **Composition root** — the only place that knows the environment. It provides
   the tags: the adapter for `EntityRepositoryTag`, the per-call input for
   `EntityLoadRequestTag` / `EntityIdTag`, and a resolver for
   `EntityLinkResolverTag`. On the web this is a Next page; on a backend it is
   the service's `AppLayer` + route handlers.

Because the requirement set lives in the Effect type (`R` channel), a missing
dependency is a **compile error**, not a runtime surprise.

```
        ┌──────────────── use-case (business) ────────────────┐
        │  loadUCFactory<Product>()  yields EntityRepositoryTag │
        └───────────────────────────┬──────────────────────────┘
                    provide the tag  │  at the composition root
        ┌───────────────────────────┴──────────────────────────┐
   web  │  EntityRepositoryTag = buildEntityRestAdapter*(...)    │  → HTTP
backend │  EntityRepositoryTag = makeMongoRepository(db, Ctor)   │  → MongoDB
        └───────────────────────────────────────────────────────┘
```

See [ENTIFIX.md](./ENTIFIX.md) for how the entities and links make this work.

### A load, end to end (products)

The web and the backend run the **same** `loadProductsUCFactory()`; only the
adapters behind the tags differ.

```
Product (business, @entity + EntityLink brand/category)
  └─ loadProductsUCFactory()  ── loads a page, reloads unresolved links via EntityLinkResolverTag
       ├─ web: ProductTable (EntityTable) → ProductListClientPage → /catalog/product (marketplace-admin-app)
       │        tags ← REST adapter + useEntityLinkResolver([[ProductBrand, …], [ProductCategory, …]])
       │        columns/labels/formatting ← Product's accessor metadata (describeEntityColumns)
       └─ backend: GET /api/product (marketplace-admin-service)
                tags ← makeMongoRepository(db, Product) + makeMongoLinkResolver(db, [ProductBrand, ProductCategory])
                then serializeEntityCollection(...) → JSON
```

Foreign-key vs embedded relations are handled transparently by the shared
(de)serializer — see `packages/entifix/ts/core/src/entity-definition`.

## Backends: Effect-native services

Backends compose `@r10c/shells-effect-service` (`@effect/platform` HTTP server,
`/api/health`, `Layer` DI, graceful shutdown) and compile stage-3 decorators like
entifix, so they import entity classes natively. There is **no Nest**: DI is
Effect Layers.

- **config-service** (`:3190`, Postgres) — source of truth for cross-service
  config. `GET /api/config/:service` returns `ConfigurationPlain` from the
  `configuration` table (migrated + seeded on first boot). Consumers read it at
  boot: frontends resolve their backend URL, backends resolve their `mongo.uri`/`db`.
- **marketplace-admin-service** (`:3101`, Mongo) — serves the product catalog
  through the entifix use-cases. Writes (`POST`) run as transactions (see
  [Transactions](#transactions-cqrs-writes)); reads/`PUT`/`DELETE` are unchanged.
- **auth-service** (`:3102`, Mongo + Redis) — serves `UserIdentity`/`EntityIdentifier`
  and owns the credential flow: `register`/`login`/`logout`/`refresh` (see
  [Auth: sessions + tokens](#auth-sessions--tokens)).
- **transaction-manager** (`:3103`, Mongo + RabbitMQ) — passive saga tracker:
  subscribes to the transaction event bus, records each transaction's lifecycle,
  and flags stalls. `GET /api/transaction/:id` is what a client polls.

Every service also exposes `GET /api/config` returning its own loaded parameters
(credentials redacted) for diagnostics. Boot order:
`Postgres → config-service → (mongo services)`.

## Observability & tooling

Instrument once against **OTLP** (vendor-neutral), so the storage backend is a
swappable seam — Grafana Cloud in production (via an OpenTelemetry Collector),
`grafana/otel-lgtm` locally. The full decision is [ADR 0001](adr/0001-observability-and-tooling.md).

- **`@r10c/entifix-ts-tooling`** is a framework-free leaf (built on the OTel
  standard, *not* an Effect wrap, so the browser and Next server can use it too).
  `/logging` exposes `createLogger({ service, level, sink, redact })` over a
  pluggable `LogSink`; every record carries the service, an OTel `SeverityNumber`,
  and — when a span is active — the `trace_id`/`span_id`, so logs join their
  traces. Sinks pick the transport: `makeStdoutJsonSink` (cluster → Collector
  filelog), `makeOtlpHttpLogSink` (dev → otel-lgtm; batches + interval-flushes),
  the `LogSink` interface for anything else. `/tracking` holds the `Tracker`
  interface (product analytics — a *separate* concern from logs, backed by
  PostHog via `@r10c/entifix-ts-posthog-client`, never routed into Loki/OTel).
- **Do not wrap OpenTelemetry in a `Context.Tag`** — it is cross-cutting and
  already vendor-neutral. The product-analytics SDK *is* wrapped (a real vendor).
- **Composition** happens at the existing roots, never in the shared packages: a
  service merges an observability layer into its `AppLayer` (replaces Effect's
  default logger with the tooling logger + stands up the OTel tracer), reading
  `logging.level`/`logging.sink`/`otel.endpoint` from config-service.
  `marketplace-admin-service` is the reference wiring (`src/observability.ts`).

Two Effect/OTel gotchas the reference wiring handles: `@effect/opentelemetry`
does not register an OTel context manager (the service registers
`AsyncLocalStorageContextManager` so the active span is visible to the logger),
and `NodeRuntime.runMain` swaps the default logger for the pretty logger before
the app layer runs (`makeService` passes `disablePrettyLogger: true` so a
`Logger.replace(defaultLogger, …)` still applies).

## Auth: sessions + tokens

auth-service owns credentials end to end (approach B — opaque session +
short-lived signed token, chosen over a bare JWT so a session is revocable):

- `POST /api/auth/register` / `/login` run `registerUserUCFactory`/`loginUCFactory`
  (`business-ts-authn`) against `AccountRepositoryTag` (Mongo credentials
  collection) and `PasswordHasherTag` (bcrypt), then both routes call the same
  `establishSession`: `SessionStoreTag.create` mints an opaque session id in
  Redis (the revocation handle — `entifix-ts-redis-client`'s
  `RedisSessionStoreLayer`), and `TokenServiceTag.sign` (`entifix-ts-jwt-client`'s
  jose-backed HS256 service) mints a short-lived access token carrying only
  `userId`/`subject`/`sessionId`/`roles`.
- `POST /api/auth/refresh` reads the live session, slides its TTL
  (`touch`), and mints a fresh access token — this is where the short token TTL
  becomes real revocation: once `logout` calls `SessionStoreTag.revoke`, the
  next `refresh` (or direct `read`) 401s even though old tokens haven't expired
  yet.
- Every route returns JSON (`accessToken`/`sessionId`/`expiresIn`/`principal`);
  auth-service itself sets no cookies. Each Next app owns turning that JSON into
  httpOnly cookies via its own `POST /api/auth/*` route handlers
  (`apps/*-app/src/app/api/auth/*`, `apps/*-app/src/lib/session.ts`): `r10c_sid`
  (opaque session id, 7-day) and `r10c_at` (signed access token, TTL-matched). A
  `middleware.ts` per app does an edge-only presence check on `r10c_at` —
  auth-app bounces an already-authenticated visitor away from sign-in/sign-up,
  marketplace-admin-app gates its `/account` area — with the real signature
  verification left to the backend the page calls (`requirePrincipal` below).
- Downstream services that need to authorize a request (e.g.
  marketplace-admin-service) never call auth-service or touch Redis on the hot
  path: `requirePrincipal` (`apps/marketplace-admin-service/src/auth.ts`) reads
  `r10c_at` (cookie or `Authorization: Bearer`) and verifies it statelessly via
  `TokenServiceTag` — a Mongo/Redis-free `401` check. A handler that needs the
  richer, volatile session `attributes` reads Redis directly by `sessionId`.
- `SessionStoreTag`/`TokenServiceTag` are framework-free contracts in
  `entifix-ts-business` (`sessions/`, `tokens/`); `entifix-ts-redis-client` and
  the new `entifix-ts-jwt-client` are their only concrete adapters today, so a
  future Zitadel-backed `IdentityProviderTag` can swap in without touching the
  routes or the use-cases.

## App & port convention

`-app` frontends bind **300N**, `-service` backends bind **310N**, cross-cutting
platform services use **319x**; the domain index `N` is shared per frontend/backend
pair. Infra exposes minikube NodePorts at `30000 +` the canonical port.

| Domain (`N`)            | `-app` | `-service`          |
| ----------------------- | ------ | ------------------- |
| marketplace (0)         | 3000   | 3100                |
| marketplace-admin (1)   | 3001   | 3101                |
| auth (2)                | 3002   | 3102                |
| transaction-manager (3) | —      | 3103                |
| — platform —            |        | config-service 3190 |

## Transactions (CQRS writes)

Reads stay direct; **writes become transactions**. A `POST` is a _command_: the
service runs a five-step facade — validate → lock → execute → rollback → free —
over it. `@r10c/entifix-transactions` holds the facade (each step a `*UCFactory`
in the entity-use-case style), the `runTransaction` engine, and the ports
(`LockService`, `SequenceService`, `EventBus`, `TransactionStore`,
`TransactionHandler`). Adapters mirror the entity ones: `entifix-ts-redis-client`
(lock via `SET NX`, sequences via atomic `INCR`) and `entifix-ts-amqp-client`
(RabbitMQ fanout event bus).

The engine splits at the `202` boundary: **accept** (validate + lock) is
synchronous — its failure is the client's `400`/`409`; **execute** (assign the
result, persist, free — or roll back and free) is forked past the `202` and
publishes lifecycle events. It is **choreography** — the service owns its
transaction and emits events; `transaction-manager` only observes and recovers
(passive). The client polls the manager for the outcome. The first concrete
transaction assigns a unique incremental `code` (`product-001`, `category-001`,
`brand-001`) to the catalog entities; `INCR`'s atomicity is what guarantees
uniqueness across service instances. Websockets and multi-service sagas are
deferred.

## Current domain structure

**Business domains** (`packages/business/ts/*`, pure — entities + use-cases):

- `business-ts-product-configuration-management` — `Product`, `ProductBrand`,
  `ProductCategory`; `loadProductsUCFactory` (link-following load).
- `business-ts-authn` — `UserIdentity`, `EntityIdentifier`; `resolveSession`,
  `login`, `registerUser` UCs over `AccountRepositoryTag`/`PasswordHasherTag`/
  `IdentityProviderTag`.
- `business-ts-common` — shared domain primitives.

**Entity framework** (`packages/entifix/*`):

- `entifix-ts-core` — decorators, metadata, links, types, (de)serializer,
  configuration store, and the **RSQL query codec** (`src/rsql/`).
- `entifix-ts-business` — repository/resolver contracts + use-case factories,
  plus the framework-free `SessionStoreTag`/`TokenServiceTag` contracts (see
  [Auth: sessions + tokens](#auth-sessions--tokens)).
- `entifix-ts-rest-client` — HTTP `EntityRepository` adapter (web).
- `entifix-ts-mongo-client` — MongoDB `EntityRepository` adapter (backend).
- `entifix-transactions` — transaction facade + engine + ports (framework-free).
  `entifix-ts-redis-client` (lock + sequence, and now `SessionStoreTag`'s Redis
  adapter) and `entifix-ts-amqp-client` (event bus) are its transport adapters.
- `entifix-ts-jwt-client` — `TokenServiceTag`'s jose-backed HS256 adapter
  (sign/verify short-lived access tokens).
- `entifix-react-controls` / `entifix-react-integration` — UI primitives +
  Effect-aware hooks. `entifix-style` — design tokens.
- `entifix-ts-testing-unit` — doubles, driver fakes and port contract suites for
  unit specs. `entifix-ts-testing-e2e` — the e2e layer: the `E2E_PROFILE`
  (`mock` | `live`) seam, a mock backend built from the production query
  pipeline, and the Playwright/Vitest presets. Both are test-only and private.

**Delivery** (`packages/implementation/*`, `packages/shells/*`):

- `implementation-product-configuration-management-react` — React organisms.
- `shells-next-marketplace`, `shells-next-marketplace-admin`, `shells-next-common`
  — Next pages + client adapters. `shells-effect-service` — the backend base.

**Apps** — frontends `marketplace-app`, `marketplace-admin-app`, `auth-app`;
backends `marketplace-service`, `marketplace-admin-service`, `auth-service`,
`transaction-manager`, `config-service`; plus `*-e2e` projects.

**Utils** — `utils-ts-{array,date,object,type}`.

For Nx specifics, file layout, and commands see [WORKSPACE.md](./WORKSPACE.md).
For conventions see [CONTRIBUTE.md](./CONTRIBUTE.md).
