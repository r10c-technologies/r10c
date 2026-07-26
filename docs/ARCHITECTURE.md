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
> [Auth: sessions + tokens](#auth-sessions--tokens) below), and authorization is
> now live as role aspects behind an ABAC-shaped port (see
> [Authorization](#authorization-role-aspects--permissions)). Zitadel/RS256 and a
> real rule engine are still deferred.

## Layering

The repo is layered top-to-bottom and **dependencies only point downward**; the Nx
ESLint rule `@nx/enforce-module-boundaries` fails the build on any upward edge. The
layer diagram and the three tag dimensions (`layer` / `scope` / `entifix`) that
encode the hierarchy are the single source in
[_shared/layering.md](_shared/layering.md); the constraints are detailed in
[DEVELOPING.md → Module boundaries](./DEVELOPING.md#module-boundaries).

The value of the layering is substitutability: a use-case in `business` depends only
on contracts (`entifix-ts-business`), never on a transport, so the same use-case runs
on the web against a REST adapter and on a backend against a Mongo adapter — the
transport is injected at the composition root.

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
  standard, _not_ an Effect wrap, so the browser and Next server can use it too).
  `/logging` exposes `createLogger({ service, level, sink, redact })` over a
  pluggable `LogSink`; every record carries the service, an OTel `SeverityNumber`,
  and — when a span is active — the `trace_id`/`span_id`, so logs join their
  traces. Sinks pick the transport: `makeStdoutJsonSink` (cluster → Collector
  filelog), `makeOtlpHttpLogSink` (dev → otel-lgtm; batches + interval-flushes),
  the `LogSink` interface for anything else. `/tracking` holds the `Tracker`
  interface (product analytics — a _separate_ concern from logs, backed by
  PostHog via `@r10c/entifix-ts-posthog-client`, never routed into Loki/OTel).
- **Do not wrap OpenTelemetry in a `Context.Tag`** — it is cross-cutting and
  already vendor-neutral. The product-analytics SDK _is_ wrapped (a real vendor).
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
- `POST /api/auth/refresh` slides the live session (`touch`, **clamped to its
  `absoluteExpiresAt`**) and mints a fresh access token — this is where the short
  token TTL becomes real revocation: once `logout` calls `SessionStoreTag.revoke`,
  the next `refresh` (or direct `read`) 401s even though old tokens haven't
  expired yet.
- **Session lifetime is sliding-under-a-ceiling**: idle 1 day, absolute 7 days,
  access token 15 min, all five constants in one `scope:shared` module
  (`business-ts-authn/values/session-policy.ts`) because the service and every
  app need the same numbers. What slides the session is *user* activity, not
  traffic: `requirePrincipal` stays stateless and never reads Redis, so the
  browser's `useSessionRefresh` hook (`@r10c/shells-next-common`) refreshes at
  80% of the token's life and **stops after 15 minutes without interaction** —
  an abandoned tab lets its session age out. See
  [ADR 0004](adr/0004-session-lifetime-devices-and-recovery.md).
- Every route returns JSON (`accessToken`/`sessionId`/`expiresIn`/
  `sessionExpiresIn`/`principal`); auth-service itself sets no cookies. Each Next
  app owns turning that JSON into httpOnly cookies via its own
  `POST /api/auth/*` route handlers (`apps/*-app/src/app/api/auth/*`,
  `apps/*-app/src/lib/session.ts`): `r10c_sid` and `r10c_at`, **both sized to the
  session, not to the token** — a cookie that dies with the token makes an
  expired token indistinguishable from no session, which is what used to sign
  everyone out every 15 minutes. The shared refresh handler is
  `createRefreshRoute` from `@r10c/shells-next-common/server` (a banner-free
  rollup entry, because a `"use client"` route handler is not a route handler);
  each app mounts its own, since cookies are per-origin. A `middleware.ts` per
  app does an edge-only presence check on `r10c_at` — auth-app classifies paths
  (`/`+`/signup` bounce when authenticated, `/account/*`+`/users` require a
  session, `/forgot-password`+`/reset-password` are open either way),
  marketplace-admin-app gates the whole app — with the real signature
  verification left to the backend the page calls (`requirePrincipal` below).
- **Account self-service** lives entirely in auth-app (`/account`,
  `/account/password`, `/account/sessions`); other apps link across through the
  `AccountMenu` in the back-office top bar, with the locale baked into the
  absolute URL. `/account` sits in its own `(account)` route group, because the
  `(back-office)` layout additionally demands `authn:user-identity:read` and a
  plain `user` must still reach their own account.
- **Devices** are an opaque `r10c_did` cookie plus a `userAgent()`-parsed label,
  captured at the app edge and stored durably as `UserDevice` in Mongo. They are
  a label for the session list and for "new device signed in" notifications, and
  **never an authorization input**.
- **Recovery**: `OneTimeTokenStoreTag` (`entifix-ts-business`, Redis adapter)
  stores only a hash and redeems with `GETDEL`; `forgot` always answers `202`;
  the link exists only in the notification, which in development lands in a Mongo
  outbox behind `GET /api/dev/outbox` (404 in production). Repeated failures trip
  an `AttemptLimiterTag` lock → `429`, keyed identifier+source and auto-expiring.
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

## Authorization: role aspects + permissions

Authentication answers _who_; this answers _what_. The whole policy lives in
`@r10c/business-ts-authz` (`layer:business`, `scope:shared`) — pure and
Effect-free apart from the DI tag, so the identical check runs in a service, a
Next server component, edge middleware and the browser. See
[ADR 0002](./adr/0002-authorization-roles-and-abac.md).

- **The aspect is a role on the user.** `UserIdentity.role` is one of `user` ‹
  `admin` ‹ `super-admin`, declared with `@accessor({ type: 'enum', … })` so it
  renders in `EntityTable`/`EntityForm` and is filterable server-side for free.
  `authSubjectFromUser` projects it into `AuthSubject.roles` — the single point
  where it enters the session, the token claims and every `Principal`.
- **A permission is `<domain>:<entityKey>:<action>`**, derived from the entity's
  own `@entity({ domain, key })` metadata (`permissionForEntity(Ctor, action)`),
  with `*` as a wildcard segment on the granted side. One vocabulary for guards,
  nav items and UI; a new entity becomes guardable with no new vocabulary.
- **Grants come from roles at each consumer**, not from the token. The token
  still carries only `roles`; `ROLE_PERMISSIONS` expands them via
  `can(roles, permission)`. A role or status change **revokes that user's
  sessions**, so a demotion is immediate rather than waiting out the 15-minute
  access TTL.
- **`PolicyDecisionTag` is the ABAC seam.** `decide({ subject, resource, action,
context })` is already attribute-shaped; `makeStaticPolicyDecision()` ignores
  `context` and consults the role table. Swapping in a rule engine is a change of
  `Layer`, not of call sites.
- **Enforcement is layered, and only the last layer is security.** Next
  middleware does an edge presence check (a fast bounce); the server-rendered
  layout filters nav with `can(...)` and gates auth-app's back-office; the
  service guard `requirePermission` (`@r10c/shells-effect-service`) verifies the
  token and asks the policy — `401` unauthenticated, `403` denied. The role gate
  sits in the server layout rather than middleware so `jwt.secret` never has to
  leave config-service for the Next runtime.
- **How each layer gets the roles** differs, on purpose. A **presentation**
  decision (which nav entries to render) reads them with `unverifiedRoles`
  (`entifix-ts-jwt-client`) — the cookie is decoded, _not_ verified. Forging it
  shows someone a menu; every route behind it still goes to a service that
  verifies properly. That avoids both a service round trip per server render and
  copying the secret into the app. A **real** decision — auth-app's back-office
  gate — resolves the principal from auth-service's `/api/me` instead, and fails
  closed when it cannot.
- **Escalation:** `canAssignRole` allows creating/promoting at or below the
  actor's own tier; an edit additionally requires outranking the target's
  _current_ role and forbids acting on yourself. Creating a user always runs
  `registerUserUCFactory` (hashing, identifier uniqueness, this guard), never a
  generic entity write; public signup is pinned to `user`. A refusal is a
  `ForbiddenError` → **403**, distinct from an identifier conflict (409).
- **Browser → service traffic is same-origin.** Catalog adapters call
  marketplace-admin-app's `/api/admin/[...path]` proxy, which forwards the cookie
  upstream as a bearer token; the app's `/api/config` rewrites the service domain
  to that path before the browser sees it. A cross-origin `fetch` to `:3101`
  carries no cookie — host-scoping decides which host _stores_ it, not which
  requests send it — so the guard would answer 401 to every browser read.

## App & port convention

`-app` frontends bind **300N**, `-service` backends bind **310N**, cross-cutting
platform services use **319x** (the domain index `N` is shared per frontend/backend
pair; infra exposes minikube NodePorts at `30000 +` the canonical port). The full
port table is the single source in [_shared/ports.md](_shared/ports.md).

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

## Workspace tabs & client data layer

The marketplace-admin frontend has a **browser-like tab workspace** backed by a
client data layer where **TanStack Query wraps the Entifix use-cases** (it caches
and orchestrates; the Effect UC/adapter pattern is untouched). Client state lives
in Zustand + IndexedDB, server state in the query cache, and a framework-free
`ReactiveChannel` port lets the coming WebSocket reconcile optimistic writes. Full
design: [FRONTEND.md → Workspace tabs](./FRONTEND.md#part-2--workspace-tabs--the-client-data-layer).

## Current domain structure

**Business domains** (`packages/business/ts/*`, pure — entities + use-cases):

- `business-ts-product-configuration-management` — `Product`, `ProductBrand`,
  `ProductCategory`; `loadProductsUCFactory` (link-following load).
- `business-ts-authn` — `UserIdentity` (carrying the `role` aspect),
  `EntityIdentifier`; `resolveSession`, `login`, `registerUser` UCs over
  `AccountRepositoryTag`/`PasswordHasherTag`/`IdentityProviderTag`.
- `business-ts-authz` — the authorization policy: `Permission`/`Role`,
  `ROLE_PERMISSIONS`, the pure `can()` check and the `PolicyDecisionTag` port
  (see [Authorization](#authorization-role-aspects--permissions)).
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

**Apps** — frontends `marketplace-app`, `marketplace-admin-app`, `auth-app`
(sign-in/sign-up **plus** a `(back-office)` group for user management, gated to
`admin`+); backends `marketplace-service`, `marketplace-admin-service`,
`auth-service`, `transaction-manager`, `config-service`; plus `*-e2e` projects.

**Utils** — `utils-ts-{array,date,object,type}`.

For Nx specifics, file layout, commands, and conventions see
[DEVELOPING.md](./DEVELOPING.md). For the client side (design system + workspace
tabs) see [FRONTEND.md](./FRONTEND.md).
