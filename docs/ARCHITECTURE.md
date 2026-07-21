# Architecture

> **Status (2026-07)** — Layered monorepo in active development. The entity
> framework (entifix), the product-catalog and authn domains, the Next.js
> frontends, and the Effect-native backends are all in place. Backends are now
> wired to real datastores: **config-service → PostgreSQL**, **marketplace-admin-service**
> and **auth-service → MongoDB**. **Full CRUD** runs end-to-end for the
> marketplace-admin catalog: `load`/`get`/`save`/`delete` over REST on the web and
> Mongo on the backend, with every message framed as an
> [EntifixEnvelope](./ENTIFIX.md#6-the-envelope-is-the-message). auth-service is
> still on the pre-envelope wire shape (read-only, no client consumes it through
> the REST adapters). Zitadel/session auth is still a stub.

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
- **auth-service** (`:3102`, Mongo) — serves `UserIdentity`/`EntityIdentifier`;
  session resolution is still a stub.
- **transaction-manager** (`:3103`, Mongo + RabbitMQ) — passive saga tracker:
  subscribes to the transaction event bus, records each transaction's lifecycle,
  and flags stalls. `GET /api/transaction/:id` is what a client polls.

Every service also exposes `GET /api/config` returning its own loaded parameters
(credentials redacted) for diagnostics. Boot order:
`Postgres → config-service → (mongo services)`.

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
- `business-ts-authn` — `UserIdentity`, `EntityIdentifier`; `resolveSession` UC.
- `business-ts-common` — shared domain primitives.

**Entity framework** (`packages/entifix/*`):

- `entifix-ts-core` — decorators, metadata, links, types, (de)serializer,
  configuration store, and the **RSQL query codec** (`src/rsql/`).
- `entifix-ts-business` — repository/resolver contracts + use-case factories.
- `entifix-ts-rest-client` — HTTP `EntityRepository` adapter (web).
- `entifix-ts-mongo-client` — MongoDB `EntityRepository` adapter (backend).
- `entifix-transactions` — transaction facade + engine + ports (framework-free).
  `entifix-ts-redis-client` (lock + sequence) and `entifix-ts-amqp-client` (event
  bus) are its transport adapters.
- `entifix-react-controls` / `entifix-react-integration` — UI primitives +
  Effect-aware hooks. `entifix-style` — design tokens.

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
