# Architecture

This document is the **technical** architecture: layers, mechanisms, transports.
The **business** architecture — which capabilities exist, what they are called,
which data plane they live in, and how they extend — is
[BUSINESS-ARCHITECTURE.md](./BUSINESS-ARCHITECTURE.md).

> **Status (2026-08)** — Layered monorepo in active development. The entity
> framework (entifix), the product-catalog, authn, authz, party- and
> access-management domains, the Next.js frontends, and the Effect-native
> backends are all in place. Backends are wired to real datastores:
> **config-service → PostgreSQL**, **marketplace-admin-service** and
> **auth-service → MongoDB**. **Full CRUD** runs end-to-end for the
> marketplace-admin catalog: `load`/`get`/`save`/`delete` over REST on the web and
> Mongo on the backend — and the same use-cases run against Postgres through
> `entifix-ts-sql-client`, which is what config-service's own operator CRUD uses —
> with every message framed as an
> [EntifixEnvelope](./ENTIFIX.md#the-envelope-is-the-message). auth-service is
> still on the pre-envelope wire shape for its `UserIdentity`/`EntityIdentifier`
> reads (no client consumes it through the REST adapters), but its sign-in
> flow is real: Zitadel authenticates (authorization code + PKCE), and r10c keeps
> Redis-backed sessions + short-lived **RS256** JWTs (see
> [Auth: sessions + tokens](#auth-sessions--tokens) below), and authorization is
> live as role aspects behind an ABAC-shaped port (see
> [Authorization](#authorization-role-aspects--permissions)).
>
> **Multi-tenancy is live on the tenant plane**: the catalog physically lives in
> its own Mongo database per organization, resolved per request from the session
> (see [Tenancy](#tenancy-resolving-the-organizations-storage)). An organization
> now has **two** tenant databases — `tenant_<id>` for the `catalog` store and
> `stock_<id>` for `stock` — because they are two stores with two writing slices
> ([ADR 0022](./adr/0022-v1-marketplace-module-boundaries.md)). Copy ships `es`/`en`
> through mandatory i18n, and marketplace-app renders the storefront on the
> server, prerendered per locale. Access tokens are **RS256**, verified against a
> public key ([ADR 0015](./adr/0015-asymmetric-access-tokens-and-the-party-role-claim.md)),
> and **Zitadel now authenticates** — authorization code + PKCE against its hosted
> UI, with r10c holding no credential at all
> ([ADR 0016](./adr/0016-zitadel-authenticates-r10c-authorizes.md)). A real rule
> engine, tenant
> storage on Postgres ([ADR 0013](./adr/0013-tenant-storage-on-postgres.md)),
> catalog publication into the platform plane
> ([ADR 0009](./adr/0009-catalog-authoring-and-publication.md)) and stock/orders
> are still deferred.

## Layering

The repo is layered top-to-bottom and **dependencies only point downward**; the Nx
ESLint rule `@nx/enforce-module-boundaries` fails the build on any upward edge. The
layer diagram and the six tag dimensions (`layer` / `scope` / `entifix` /
`business` / `shell` / `host`) that encode the hierarchy are the single source in
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
       ├─ web: ProductTable (EntityTable) → ProductListClientPage → /catalog/product (back-office-app)
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

  It also serves the **operator CRUD** at `/api/configuration…`, behind
  `config:configuration:*` — derived from the `Configuration` entity's own
  `@entity({ domain, key })`, so only `super-admin` (`*:*:*`) holds it. Those routes
  run the same entifix use-cases as every other service, over the relational
  adapter (`makeSqlRepository`). Two rules live in the route layer, not the adapter:
  a row flagged `is_secret` has its value blanked on read and preserved on a blank
  write (**write-only credentials**, and clearing the flag requires supplying a new
  value, or `write` would become a read of every secret in the fleet); and every
  write appends to the append-only `configuration_audit` table in the same
  transaction, recording the actor but never a secret's plaintext.

  The two `GET /api/config…` routes are gated on a shared **`X-Service-Token`**
  (`CONFIG_SERVICE_TOKEN`, with a documented dev default). They cannot be redacted —
  a booting service needs the real connection strings — so the port is no longer
  self-serve. This is fleet membership, **not** service identity: every caller
  presents the same token. The health endpoints themselves stay unauthenticated by
  design.

  Three callers send it: `loadRemoteConfiguration` when a service boots, and — in
  `shells-next-common`, sharing `lib/config/service-token.ts` — an app's
  `createConfigRoute` and its **readiness probe**. The probe belongs on that list
  because readiness _reads_ the gated route: without the header it sees a `401`,
  reports `degraded`, and the app never becomes Ready despite being healthy, which
  in Kubernetes means a rollout that never takes traffic.

  It verifies access tokens with `jwt.publicKey`/`jwt.keyId` read **from its own
  table via SQL** at boot, never over HTTP from itself — that is what closes the
  bootstrap cycle. Only the public half: config-service verifies tokens and never
  mints them, so it has no use for `jwt.privateKey` and holding it would be a
  second copy of the signing key for nothing.

- **marketplace-admin-service** (`:3101`, Mongo) — serves the product catalog
  through the entifix use-cases. Writes (`POST`) run as transactions (see
  [Transactions](#transactions-cqrs-writes)); reads/`PUT`/`DELETE` are unchanged.
- **auth-service** (`:3102`, Mongo + Redis) — serves `UserIdentity`/`EntityIdentifier`
  and owns the credential flow: `register`/`login`/`logout`/`refresh` (see
  [Auth: sessions + tokens](#auth-sessions--tokens)).
- **the `transaction` slice** (co-deployed into marketplace-admin-service on
  `:3101`; Mongo + RabbitMQ) — passive saga tracker: subscribes to the
  transaction event bus, records each transaction's lifecycle, and flags stalls.
  `GET /api/transaction/:id` is what a client polls, and
  `GET /api/transaction/events` is the same facts pushed instead
  ([ADR 0036](adr/0036-the-reactive-stream-is-server-sent-and-same-origin.md)).
  Both are behind `requirePrincipal` and scoped to the caller's organization; the
  unfiltered `GET /api/transaction` was deleted rather than filtered, because it
  answered every organization's transactions to anyone. It owns the `saga` store and
  is therefore a Slice in its own right; sharing a process with
  `marketplace-admin` is a deployment fact, not an ownership one, and its code
  lives together under `apps/marketplace-admin-service/src/saga/` so that
  splitting it back out is a directory move. See
  [Stores, slices & data planes](../docs/_shared/planes.md).

Every service also exposes `GET /api/config` returning its own loaded parameters
(credentials redacted) for diagnostics. Boot order:
`Postgres → config-service → (mongo services)`.

### Health: liveness vs readiness

Every app **and** service answers three endpoints — `/api/health` (unchanged,
what Playwright's `readyPath` waits on), `/api/health/live`, `/api/health/ready`.
They are containerisation-ready today even though nothing is containerised yet.

| Probe     | Question               | Depends on                    | What an orchestrator does  |
| --------- | ---------------------- | ----------------------------- | -------------------------- |
| liveness  | is the process wedged? | **nothing**                   | restarts the pod           |
| readiness | can it serve now?      | Mongo / Redis / AMQP / config | drains traffic, no restart |

**Liveness must never check a dependency.** A liveness probe wired to Mongo
turns a datastore blip into "every replica restarts" — an outage the probe
caused. Readiness answers `200`, or `503 {status:'degraded', failing:[…]}` with
probe **names** only: the endpoint is unauthenticated by necessity, so it never
returns a URI, host, or driver message.

Backends build the answer from a **probe registry** (`HealthRegistryTag` in
`@r10c/entifix-ts-business`): `MongoHealthProbeLayer`, `RedisHealthProbeLayer`
and `AmqpHealthProbeLayer` ship with the clients they describe, so a service
that gains a datastore gains its readiness probe by merging one layer — nothing
in the service hand-maintains a list that can drift. `makeServerLayer` provides
the registry (`Layer.provideMerge`, so probes and the route share one instance)
and mounts the routes.

A probe also says **what** it is for: `kind` (`datastore` / `broker` /
`upstream`) and `targets`, the logical names it covers — a Store's register name
(`catalog`, `saga`), an exchange (`entifix.events`), a service (`zitadel`).
Readiness ignores both, and its wire format is unchanged; they exist so the
description below generates from this one registration. `targets` is a **list**
because one connection routinely backs several Stores, and the datastore layers
take it as an argument (`MongoHealthProbeLayer(['catalog', 'saga'])`) because a
client package cannot know a Store's register name.

Two properties the implementation is load-bearing on:

- **Every probe is deadlined** (2s, in the registry). ioredis queues commands
  while disconnected instead of rejecting, so without it `/api/health/ready`
  _hangs_ the moment a datastore disappears — exactly when it must answer.
- **Results are cached ~1s**, so an unauthenticated endpoint cannot be used as
  a free lever on the datastore.

Apps check only their own configuration, never the domain backend: cascading
readiness turns one degraded service into a fleet-wide outage, and a page that
renders against a degraded backend is still worth serving.

### The wiring document: `GET /api/$service`

A third endpoint describes a service's _wiring_ — the slices it hosts, the
stores it opened, the events it published and the subscriptions it bound, the
upstreams it calls ([ADR 0031](adr/0031-a-service-describes-its-own-wiring.md)).
It is a sibling of `/api/config`, never part of it: config serves the _inputs_ a
service was given (values, redacted); this serves its _shape_.

It is mounted by `makeServerLayer`, like the health routes, so a service gains
it by composition. `ServiceDefinition` carries one new field, `slices` — it
cannot be derived, because `EventSourceTag` names only the _emitting_ slice and
one deployment may host several (marketplace-admin-service also runs
`transaction`). Stores, brokers and upstreams come from the probe registrations;
publishes and bindings come from a `WiringRegistry` the AMQP adapter records
into as it publishes and subscribes, so the document reports what the process
**did**, not what a declaration says.

Three endpoints, one process, three different gates — liveness stays
process-only, readiness stays unauthenticated and names-only, and the
description is **service-token gated** because it is a map of the system.
**Logical names only**: `catalog`, never `mongodb://…` and emphatically never
`tenant_<organizationId>`, which would make it an organization enumerator.

The value is the **diff**, not the document. `pnpm run dev-infra:map` walks the
fleet and prints it; `--check` fails when something _observed_ is not
_declared_ — an emitted event no hosted slice declares, a store opened that none
declares, a queue bound on an undeclared pattern, a slice hosted by a deployment
its declaration does not list. Declared-and-never-observed is printed as an
advisory rather than asserted, because a fleet that has just booted has emitted
nothing.

Clients recover on their own rather than being restarted: Mongo and Redis retry
the initial connect with backoff (30s window, so a service that boots while
infra is still rolling out survives), and Redis carries an explicit
`retryStrategy` plus `enableOfflineQueue: false` so a dropped connection
re-establishes and commands fail fast meanwhile. Measured on a live stack:
`ready` → Redis scaled to 0 → `503 failing:["redis"]` → Redis back → `200`
within 7s, no restart. **amqplib has no recovery of its own**, so
`AmqpChannelTag` carries an `AmqpConnector` rather than a channel: it reopens on
demand and re-registers every consumer against the new channel, because a
subscriber's queue died with the old connection and nothing else rebinds it. Its
probe runs through the connector for the same reason — a failed passive
`checkExchange` closes the channel, so probing a held one was itself a way to
break the bus.

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

**Metrics have no exporter yet.** `observability.ts` builds `NodeSdk` with an
`OTLPTraceExporter` and nothing else — no `MeterProvider` — so a `Metric.*` call
goes nowhere while logs and traces reach the Collector. The destination was
decided in ADR 0001 and is unchanged; the first metric set (bus published /
consumed / failed / quarantined, outbox depth and oldest-entry age, transactions
by state) is named in that record's 2026-09-01 revision. #185 builds the
pipeline, #186 the instrumentation.

Two Effect/OTel gotchas the reference wiring handles: `@effect/opentelemetry`
does not register an OTel context manager (the service registers
`AsyncLocalStorageContextManager` so the active span is visible to the logger),
and `NodeRuntime.runMain` swaps the default logger for the pretty logger before
the app layer runs (`makeService` passes `disablePrettyLogger: true` so a
`Logger.replace(defaultLogger, …)` still applies).

## Auth: sessions + tokens

**Zitadel authenticates; r10c authorizes** ([ADR 0016](./adr/0016-zitadel-authenticates-r10c-authorizes.md)).
auth-service is an OIDC client and holds no credential of any kind — no hash, no
lockout ledger, no `PasswordHasher`, and no `AccountRepository` method that could
read or write a secret. What it keeps is the session (approach B — opaque session

- short-lived signed token, chosen over a bare JWT so a session is revocable):

* `POST /api/auth/oidc/start` mints a PKCE pair (`entifix-ts-zitadel-client`) and
  stashes `{codeVerifier, nonce, redirect}` in the one-time token store. The token
  it mints **is** the `state`: unguessable, single-use, TTL'd and hashed at rest
  is exactly what a `state` handle wants, so there is no second value to keep in
  step. The verifier never leaves the server, which is what makes a **public**
  client (no secret) safe.
* `POST /api/auth/oidc/callback` consumes that token — which is the CSRF check and
  the replay check in one, since an unknown or spent `state` never reaches the
  token endpoint — exchanges the code, and verifies the `id_token` with
  `algorithms: ['RS256']` pinned and the `nonce` compared separately. It then
  resolves the `sub` to a `UserIdentity`, **provisioning one at `role: user` on
  first sight** through the same `registerUserUCFactory` an administrative create
  runs, projects the identity attributes, and calls the unchanged
  `establishSession`: `SessionStoreTag.create` mints an opaque session id in
  Redis (the revocation handle — `entifix-ts-redis-client`'s
  `RedisSessionStoreLayer`), and `TokenServiceTag.sign` (`entifix-ts-jwt-client`'s
  jose-backed RS256 service) mints a short-lived access token carrying only
  `userId`/`subject`/`sessionId`/`roles`/`activeOrganizationId`/`partyRole`.
* **One writer per field.** Two records exist for one person and only one system
  writes each member: Zitadel owns the password, MFA enrolment, social links, the
  email/username identifier values and `displayName`; r10c owns `role`, `status`,
  party, devices and sessions. The local copies of Zitadel-owned attributes are
  **projections**, overwritten from the verified `id_token` on every callback —
  they can lag a change made at the provider but cannot diverge from it, because
  nothing here is ever the thing that was edited.
* **Provisioning is local-first with repair on retry, not a saga.** The local
  record goes first (it owns the role and the party), the Zitadel human second. A
  failed provider write leaves an account with no `external-subject`: it cannot
  sign in, it is listed like any other, and re-submitting the same form repairs
  it. One legible half-state beats a compensation that can itself fail — and the
  saga engine could only ever have covered the rarer path, since the callback's
  auto-provisioning must return a session synchronously.
* `POST /api/auth/refresh` slides the live session (`touch`, **clamped to its
  `absoluteExpiresAt`**) and mints a fresh access token — this is where the short
  token TTL becomes real revocation: once `logout` calls `SessionStoreTag.revoke`,
  the next `refresh` (or direct `read`) 401s even though old tokens haven't
  expired yet.
* **Session lifetime is sliding-under-a-ceiling**: idle 1 day, absolute 7 days,
  access token 15 min, all five constants in one `scope:shared` module
  (`business-ts-authn/values/session-policy.ts`) because the service and every
  app need the same numbers. What slides the session is _user_ activity, not
  traffic: `requirePrincipal` stays stateless and never reads Redis, so the
  browser's `useSessionRefresh` hook (`@r10c/shells-next-common`) refreshes at
  80% of the token's life and **stops after 15 minutes without interaction** —
  an abandoned tab lets its session age out. See
  [ADR 0004](adr/0004-session-lifetime-devices-and-recovery.md).
* **Sign-out is two steps.** `POST /api/auth/logout` revokes the Redis session
  _and_ returns an RP-initiated `endSessionUrl`, built from the `id_token` the
  callback stashed under the session id in Redis. That token is deliberately not
  put in the session's `attributes` bag, free as that would have been: attributes
  travel into every `Principal` the service returns, including `GET /api/me`,
  which a Next server layout hands to the browser. Every sign-out control
  navigates to the returned URL — clearing our cookies alone leaves someone
  "signed out" who is one click from being let straight back in with no prompt.
* **Sign-out also arrives from the other direction.**
  `POST /api/auth/backchannel-logout` is what Zitadel calls when a session it
  owns ends, and without it the r10c session survived to its seven-day ceiling
  while `refresh` kept minting. The mapping is a second Redis index next to
  `oidc:id-token:` — `oidc:sid:{sid}`, a **set**, because one provider session
  can open several of ours — written from the `sid` claim of the verified
  `id_token` at callback. The route is unauthenticated by necessity (the caller
  is a server) and the token's signature is the authentication:
  `verifyLogoutToken` shares one pinned-`algorithms` verifier with the id_token
  path and then requires the back-channel `events` claim, a `sub` or `sid`, and
  **no `nonce`** — that absence is what stops a stolen `id_token` being POSTed
  here. A `sid` revokes exactly its sessions; only a `sub`, or a `sid` that
  resolves to nothing, falls back to `revokeAllForUser`. Unknown ids answer
  `200`, so the endpoint is not an oracle. See
  [ADR 0017](adr/0017-back-channel-logout-from-the-identity-provider.md).
* **A logout token covers a session ending, not a user ending.** Deactivating a
  user in Zitadel fires no token at all — measured — so
  `POST /api/auth/provider-events` takes that half over an **Actions v2** event
  execution: `user.deactivated`, `user.locked` and `user.removed` reach one
  `restAsync` target, and the handler resolves the payload's `aggregateID` (the
  same `sub` the identifier rows carry) and calls `revokeAllForUser`. Its
  authentication is an HMAC rather than a JWT — `ZITADEL-Signature` over
  `"<timestamp>.<raw body>"`, verified against a per-target signing key from
  config-service, empty key meaning reject — which is why it lives beside the
  OIDC client rather than inside it, and why the body is read raw. It does not
  touch `UserIdentity.status`: nothing projects status back from the provider, so
  writing one here would outlive a reactivation. See
  [ADR 0019](adr/0019-provider-user-lifecycle-events-revoke-sessions.md).
* Every route returns JSON (`accessToken`/`sessionId`/`expiresIn`/
  `sessionExpiresIn`/`principal`); auth-service itself sets no cookies. Each Next
  app owns turning that JSON into httpOnly cookies via its own
  `POST /api/auth/*` route handlers (`apps/*-app/src/app/api/auth/*`,
  `apps/*-app/src/lib/session.ts`): `r10c_sid` and `r10c_at`, **both sized to the
  session, not to the token** — a cookie that dies with the token makes an
  expired token indistinguishable from no session, which is what used to sign
  everyone out every 15 minutes. The shared refresh handler is
  `createRefreshRoute` from `@r10c/shells-next-common/server` — anything a route
  handler or server layout _calls_ must ship from `/server` so it is never
  reached through the client surface and stamped as a client reference;
  each app mounts its own, since cookies are per-origin. A `middleware.ts` per
  app does an edge-only presence check on `r10c_at` — back-office-app classifies
  paths (`/` bounces when authenticated, `/account/*`+`/users` require a session;
  there is no third class any more, because sign-up and recovery are screens at
  the provider) — with the real signature
  verification left to the backend the page calls (`requirePrincipal` below).
* **Account self-service** lives in `shells-next-auth`, mounted by
  back-office-app at the same origin as everything else (`/account`,
  `/account/security`, `/account/sessions` — the three destinations in
  `ACCOUNT_DESTINATIONS`). The `AccountMenu` in the back-office top bar links to
  them with a plain locale-prefixed path; `accountUrls` and the absolute
  cross-origin URLs are gone with the second app that needed them.
  `/account` sits in its own `(account)` route group, because the
  `(back-office)` layout additionally demands `authn:user-identity:read` and a
  plain `user` must still reach their own account.
* **Devices** are an opaque `r10c_did` cookie plus a `userAgent()`-parsed label,
  captured at the app edge and stored durably as `UserDevice` in Mongo. They are
  a label for the session list and for "new device signed in" notifications, and
  **never an authorization input**.
* **Recovery, MFA and rate limiting are Zitadel's.** There is no reset token, no
  `forgot` endpoint and no attempt limiter here, because there is no password to
  reset or to guess; ADR 0016 supersedes those sections of ADR 0004. Provider mail
  lands in **Mailpit** in the local lab, and `/account/security` links out to the
  provider's own self-service for password, second factor and linked accounts.
  `OneTimeTokenStoreTag` survives, repurposed: it now backs the pending
  authorization above rather than a recovery link. `GET /api/dev/outbox` also
  survives, carrying the notifications r10c still sends — which are about
  _sessions_ (`NewDevice`, `SessionsRevoked`) — and still 404s in production.
* Downstream services that need to authorize a request (e.g.
  marketplace-admin-service) never call auth-service or touch Redis on the hot
  path: `requirePrincipal` (`apps/marketplace-admin-service/src/auth.ts`) reads
  `r10c_at` (cookie or `Authorization: Bearer`) and verifies it statelessly via
  `TokenServiceTag` — a Mongo/Redis-free `401` check. A handler that needs the
  richer, volatile session `attributes` reads Redis directly by `sessionId`.
* **Tokens are RS256 and only auth-service can mint one.** It alone resolves
  `jwt.privateKey`; every other service resolves `jwt.publicKey` + `jwt.keyId` and
  is structurally incapable of forging a principal. `verifyAccessToken` pins
  `algorithms: ['RS256']` — without it jose honours the token's own `alg` header
  and the public key, which `/.well-known/jwks.json` hands to anyone, would be
  accepted as an HMAC secret. auth-service serves that JWKS endpoint for
  consumers holding no fleet configuration (a browser, an edge runtime); no fleet
  service reads it, so verification never depends on auth-service being up. See
  [ADR 0015](./adr/0015-asymmetric-access-tokens-and-the-party-role-claim.md).
* **A session carries the population it belongs to.** `partyRole`
  (`customer`/`vendor`/`operator`) is resolved once at sign-in by
  `SessionScopeResolver` — the same party→membership lookup that answers
  `activeOrganizationId` — stored on the session and re-signed unchanged on
  refresh. It exists because an absent organization means _both_ a buyer and an
  operator, and the difference in reach is enormous. It is routing context, never
  a grant.
* **`GET /api/config` is unauthenticated, so it blanks flagged secrets.**
  `ConfigurationItem.isSecret` is propagated from config-service's `is_secret`
  column and `redactConfiguration` blanks it. The URI credential mask alone was
  not enough — a signing key is not a URI.
* `SessionStoreTag`/`TokenServiceTag` are framework-free contracts in
  `entifix-ts-business` (`sessions/`, `tokens/`); `entifix-ts-redis-client`,
  `entifix-ts-jwt-client` and `entifix-ts-zitadel-client` are their concrete
  adapters. That layering is what made the swap cheap: `establishSession` and
  every downstream use-case were untouched, and the change was confined to how a
  credential gets verified.

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
  layout filters nav with `can(...)` and gates back-office-app's `(back-office)`
  route group; the
  service guard `requirePermission` (`@r10c/shells-effect-service`) verifies the
  token and asks the policy — `401` unauthenticated, `403` denied. The role gate
  sits in the server layout rather than middleware to keep verification off every
  server render; under RS256 it would only need `jwt.publicKey`, which is served
  openly at `/.well-known/jwks.json`, so the original "never copy the secret"
  reason has lapsed while the placement has not
  ([ADR 0002](adr/0002-authorization-roles-and-abac.md), revised).
- **How each layer gets the roles** differs, on purpose. A **presentation**
  decision (which nav entries to render) reads them with `unverifiedRoles`
  (`entifix-ts-jwt-client`) — the cookie is decoded, _not_ verified. Forging it
  shows someone a menu; every route behind it still goes to a service that
  verifies properly. That avoids a service round trip per server render. A
  **real** decision — the `(back-office)` route group's gate — resolves the
  principal from auth-service's `/api/me` instead, and fails closed when it
  cannot.
- **Escalation:** `canAssignRole` allows creating/promoting at or below the
  actor's own tier; an edit additionally requires outranking the target's
  _current_ role and forbids acting on yourself. Creating a user always runs
  `registerUserUCFactory` (identifier uniqueness and this guard — the hashing
  went with the credential), never a
  generic entity write; public signup is pinned to `user`. A refusal is a
  `ForbiddenError` → **403**, distinct from an identifier conflict (409).
- **Browser → service traffic is same-origin.** Catalog adapters call
  back-office-app's `/api/admin/[...path]` proxy, which forwards the cookie
  upstream as a bearer token; the app's `/api/config` rewrites the service domain
  to that path before the browser sees it. A cross-origin `fetch` to `:3101`
  carries no cookie — host-scoping decides which host _stores_ it, not which
  requests send it — so the guard would answer 401 to every browser read.

## Tenancy: resolving the organization's storage

Authorization answers _what_; this answers _whose data_. Which capability lives
in which plane is
[BUSINESS-ARCHITECTURE.md → Stores, slices, and data planes](./BUSINESS-ARCHITECTURE.md#stores-slices-and-data-planes);
the reasoning is [ADR 0006](./adr/0006-multitenancy-planes-and-tenant-storage.md).
What follows is the mechanism.

The vocabulary for ownership is `Domain → Store → Slice → Deployment`
([ADR 0020](./adr/0020-stores-and-slices.md)): the handle resolved below is the
`catalog` **Store**, whose `partitioning` is `per-organization` and whose owning
**Slice** is `marketplace-admin`. The plane belongs to the store, not to the
entity.

**Entities are organization-agnostic.** No `organizationId` member, no tenant
filter, no discriminator column. Isolation is _which database handle the request
resolves to_ — so a query cannot leak by omission, because there is no column to
forget. A discriminator makes every missing `WHERE` a silent breach; this makes
the same mistake impossible to write.

The path from cookie to collection has four steps, each in a different layer:

1. **The session names the organization.** auth-service resolves it at login —
   `individual` by `userId`, then `membership` by `partyId`, preferring
   `isDefault` — and stores it on the session record so a refresh preserves it.
   The lookup is party → membership rather than user → organization because a
   `UserIdentity` is an account, an `Individual` is the person, and a
   `Membership` is that person's participation in one organization.
2. **The token carries it.** `TokenClaims.activeOrganizationId`
   (`entifix-ts-business`) → `Principal.organizationId` (`business-ts-authn`).
   It is a **first-class field, deliberately not in `attributes`**: attributes
   are ABAC decision inputs, the organization is a storage routing key, and the
   two must not share a blast radius. A party with no membership — a buyer, an
   operator — resolves to `undefined`, which is a normal answer, not a failure.
3. **The guard requires it.** `requireOrganization(permission)`
   (`@r10c/shells-effect-service`) composes over `requirePermission` and hands
   the id to the handler. No organization → **`409 noActiveOrganization`**, not
   `403`: the caller is authenticated _and_ permitted, but the session names no
   storage to read. The value comes from the verified token and nowhere else — a
   path or body parameter naming an organization would be caller-controlled,
   which is the whole failure the guard exists to prevent. This is also why a
   `super-admin` holding `*:*:*` does **not** reach a tenant's data: a wildcard
   grant widens permissions, never scope.
4. **The resolver returns the handle.** `TenantDatabaseResolverTag`
   (`entifix-ts-business`) is the port; `makeMongoTenantResolver(client, prefix)`
   (`entifix-ts-mongo-client`) is the adapter, returning
   ``client.db(`${prefix}${organizationId}`)``. It validates the id against
   `/^[a-zA-Z0-9_-]+$/` and the 63-char Mongo limit before assembling the name,
   and never echoes a rejected id — that check is the file's security boundary.

Two invariants hold the design up:

- **The handle is request-level, never a `Layer`.** `MongoDatabaseLayer`'s
  boot-time `Layer.scoped` _is_ the connection pool; `client.db(name)` returns a
  handle, not a connection, so N organizations share one pool and one socket set.
  A `Layer` per request would rebuild the pool per request. The resolver is built
  at the composition root (`apps/marketplace-admin-service/src/mongo.ts`), the
  only file that knows which driver backs the port; `MongoClientTag` and
  `MongoDatabaseTag` come from **one** acquire via `Layer.scopedContext`, because
  two layers would mean two pools.
- **The name derives from the organization id**, never from a mutable attribute
  such as a slug, so renaming an organization cannot strand its data. Mongo
  creates a database lazily on first write, which is why provisioning is a
  control-plane record plus this naming convention, with no `CREATE DATABASE`
  step to fail halfway ([ADR 0011](./adr/0011-organization-provisioning-and-migrations.md)).

**The payoff is the `guarded` helper in
`apps/marketplace-admin-service/src/routes.ts`.** Every catalog route already
resolved its database inside the request (`const db = yield* MongoDatabaseTag`),
so re-providing that one tag with the organization's handle moved the whole
catalog onto the tenant plane — six routes redirected, and no use-case, entity,
repository, filter translator or envelope touched. That substitutability is the
reason the handle is resolved per request instead of baked into a `Layer`, and it
is the design's central claim.

`TenantDatabaseResolver<THandle>` is generic over the handle so a Postgres
adapter — where the same idea is a schema on a shared pool rather than a separate
database — satisfies the port without a call-site change
([ADR 0013](./adr/0013-tenant-storage-on-postgres.md), Proposed). An operator
crossing into a tenant is an explicit, audited act-as-organization re-mint using
this same mechanism, never an implicit resolver bypass
([ADR 0012](./adr/0012-operator-cross-tenant-access.md), Proposed).

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
(RabbitMQ topic event bus — `entifix.events`, routed by the event's own name
since [ADR 0029](adr/0029-the-event-envelope-and-a-routed-bus.md)).

The engine splits at the `202` boundary: **accept** (validate + claim + lock) is
synchronous — its failure is the client's `400`/`409`; **execute** (assign the
result, persist, free — or roll back and free) is forked past the `202`. It is
**choreography** — the service owns its transaction and emits events; the saga
tracker only observes and recovers (passive). The client polls the tracker for
the outcome, through the relative `rel: 'status'` link the `202` carries. The
first concrete transaction assigns a unique incremental `code` (`product-001`,
`category-001`, `brand-001`) to the catalog entities; `INCR`'s atomicity is what
guarantees uniqueness across service instances. Multi-service sagas are
deferred (#105); the reactive stream is not. It is
[ADR 0036](adr/0036-the-reactive-stream-is-server-sent-and-same-origin.md), it is
server-sent rather than a WebSocket, and it is built: the tracker takes a
**second** subscription to `transaction.*` in `mode: 'broadcast'` — the first in
the register, and the consumer ADR 0030 built the mode for, since every replica
holds different browser connections — feeding an in-process hub that each
connection reads a filtered view of. A `TransactionEvent` therefore carries
`organizationId`, stamped by the route from the verified token, and the filter
**fails closed**: an event carrying none reaches no tenant-scoped connection.

**The client mints the transaction id, and the event ships with the write**
([ADR 0028](adr/0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).
Two things follow from that one record.

The `POST` body is a **`command` envelope** carrying a client-generated UUID,
not an entity envelope the service turns into a command. The id is also the
stored entity's id, so the browser can address the record before the response
arrives — and it is the **idempotency key**: a repeated id is a retry, answered
`202` with the same status link and executed exactly once. There is no
server-side fallback that mints one; a command without a valid UUID is `400`.

The engine **never publishes**. Every event goes to a `TransactionOutbox`, and a
relay carries the outbox to RabbitMQ. `accepted` and `failed` are written by the
engine; `completed` is written by the **handler**, in the same Mongo transaction
as the entity — because only the handler holds a session, and a session may not
enter the framework-free `EntityRepository` or `TransactionOutbox` ports. The
engine's success path therefore records nothing, which a spec asserts. The outbox
collection lives in the **tenant** database beside the entity: same database
keeps the transaction single-shard, and an outbox holds event payloads, so a
control-plane one would move a whole offering out of the tenant plane the day
`catalog.published` rides it. Delivery is **at-least-once** — a consumer that
must not fold twice dedupes on the message's own `event.id`, never on
`transactionId`: one transaction emits up to three messages, so keying on the
correlation id would treat `completed` as a redelivery of `accepted` and drop the
outcome. The tracker needs nothing, because `upsertFromEvent` is an idempotent
upsert rather than a dedupe.

This needs a replica set, so local Mongo runs as a single-node one; production is
three nodes. Dev has no elections and no lag, so two rules are in the code rather
than left to production: drive every transaction with `session.withTransaction`
(an election aborts with a `TransientTransactionError` the _application_ must
retry), and keep the Redis sequence draw **outside** that retried callback or a
retry burns a code. `directConnection=true` on the local URI is local only —
against a hosted set it would defeat failover.

**Every bus message is an `event` envelope, and the exchange routes**
([ADR 0029](adr/0029-the-event-envelope-and-a-routed-bus.md)). `meta` gained an
optional `event` block — `name`, `id`, `source`, `at`, `correlationId` — and
`meta.entity` became optional with it, because a message about a settlement _run_
has no entity to name. The dividing rule is that **`meta` describes the message
and `data` describes the occurrence**, which is why a correlation id is metadata
and an outcome's `code` is not.

`EventBus` is typed on `DomainEvent` rather than on `TransactionEvent`, so
ADR 0009's catalog publication travels in the same envelope rather than inventing
a second framing. `source` is the emitting **slice** — not the deployment, which
co-deployment moves, and not the domain, of which a slice may hold several — and
it is for routing, observability and audit, **never a consumer branch**: a
handler that behaves differently depending on who published re-couples the
services the bus decoupled.

The exchange is `entifix.events`, type **topic**, published to with `event.name`
as the routing key; `subscribe` takes the pattern the subscriber declared in
`tools/slices/`, so the register is executable at the transport instead of prose
about it. It is a new exchange rather than a redeclared one because a broker will
not change an existing exchange's type. `@r10c/slices` now asserts that every
subscribed event has a slice declaring it published, that no slice subscribes to
its own, and that every name is routable.

**What happens when a message cannot be processed is decided, and most of it is
built** ([ADR 0030](adr/0030-failure-retry-and-quarantine-on-the-bus.md)).
Until #177 a failed handler and a malformed payload both ended in
`nack(message, false, false)` against a queue with no dead-letter exchange, so
the message was **discarded**; and a subscriber's exclusive queue died with its
connection, so anything published while it was down was dropped by the broker
even though the outbox had recorded it sent — the durability chain ended one hop
short of the consumer.

0030 separates three failure classes: **transient**, requeued so the broker
counts the redelivery against `x-delivery-limit` and dead-letters at the
ceiling; **poison**, quarantined without a single retry, because a payload that
cannot be deserialized never becomes deserializable; and a **business failure**,
which is not the bus's concern at all, having been processed successfully and
produced its own event. A subscription declares its shape — `work`, a named
durable quorum queue replicas share and that accumulates while the consumer is
gone, or `broadcast`, the exclusive queue for a consumer every replica must
receive — and failures route to `entifix.events.dlx` with a
`<queue>.quarantine` per queue, never one shared, since replaying a mixed
quarantine redelivers another subscriber's messages. The queue is named after
the **subscribing** slice, which is not `EventSourceTag`: that names the
emitter, and one deployment hosts several slices. On the publisher side the
outbox relay has a ceiling, so an entry that can never publish is quarantined
and skipped rather than blocking that tenant's outbox forever.

#177 and #179 built that, and #146 is unblocked. What remains is #178's
`TransactionInbox` — claiming `event.id` in the same storage transaction as the
side effect, which is why a subscription carries no `dedupe` declaration yet —
and #180's graceful shutdown.

The engine gains two more consumers as the business domains land, both
cross-plane and both already designed: **catalog publication**, which projects a
vendor's approved offerings from tenant storage into the platform-scope
marketplace catalog ([ADR 0009](adr/0009-catalog-authoring-and-publication.md)),
and **checkout**, whose compensation releases a stock reservation when the order
write fails ([ADR 0010](adr/0010-stock-ledger-reservations-and-concurrency.md)).
Both are the "cross-domain write goes through the saga, never one transaction"
rule in practice.

## Workspace tabs & client data layer

The marketplace-admin frontend has a **browser-like tab workspace** backed by a
client data layer where **TanStack Query wraps the Entifix use-cases** (it caches
and orchestrates; the Effect UC/adapter pattern is untouched). Client state lives
in Zustand + IndexedDB, server state in the query cache, and a framework-free
`ReactiveChannel` port carries the reactive stream — server-sent, same-origin and
scoped per connection, reached at `/api/admin/transaction/events` through the
app's own proxy
([ADR 0036](adr/0036-the-reactive-stream-is-server-sent-and-same-origin.md)). Full
design: [FRONTEND.md → Workspace tabs](./FRONTEND.md#part-2--workspace-tabs--the-client-data-layer).

## Current domain structure

The capability map, the ODA/SID naming behind it, and each domain's data plane
are in [BUSINESS-ARCHITECTURE.md](./BUSINESS-ARCHITECTURE.md). What follows is
what exists in the tree today.

The plane noted on each domain below is **derived**: a domain's entities live in
exactly one **Store**, and the plane is the store's
([ADR 0020](./adr/0020-stores-and-slices.md)). `authn` and `party-management`
share the `auth` store, which is why they are permanently co-deployed; the
register of stores is in [\_shared/planes.md](./_shared/planes.md).

**Business domains** (`packages/business/ts/*`, pure — entities + use-cases):

- `business-ts-product-configuration-management` — `Product`, `ProductBrand`,
  `ProductCategory`; `loadProductsUCFactory` (link-following load).
  **Tenant plane.**
- `business-ts-party-management` — `Organization` (the tenant), `Individual`,
  `PartyRole`. **Control plane.**
- `business-ts-access-management` — `Membership`, `Role`, `Entitlement`.
  **Control plane.**
- `business-ts-marketplace-catalog`, `-stock-management`, `-order-management`,
  `-payment-management`, `-settlement-management` — named and tagged; entities
  land with the iterations their ADRs name.
- `business-ts-authn` — `UserIdentity` (carrying the `role` aspect),
  `EntityIdentifier`, `UserDevice`; `resolveSession`, `registerUser` and the OIDC
  callback UCs over `AccountRepositoryTag`/`IdentityProviderTag`. There is no
  `PasswordHasherTag` — auth-service holds no credential
  ([ADR 0016](adr/0016-zitadel-authenticates-r10c-authorizes.md)).
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
- `entifix-ts-mongo-client` — MongoDB `EntityRepository` adapter (backend), plus
  the `TenantDatabaseResolver` adapter that gives each organization its own
  database off the shared client (see [Tenancy](#tenancy-resolving-the-organizations-storage)).
- `entifix-ts-sql-client` — PostgreSQL `EntityRepository` adapter (backend) over
  `@effect/sql`. An accessor's `alias` **is** its column, so a scalar entity's
  serialized form already is a table row; the filter translator emits only
  parameterized fragments and validates every identifier against the entity's
  `filterable`/`sortable` allowlist before interpolation.
- `entifix-transactions` — transaction facade + engine + ports (framework-free).
  `entifix-ts-redis-client` (lock + sequence, and now `SessionStoreTag`'s Redis
  adapter) and `entifix-ts-amqp-client` (event bus) are its transport adapters.
- `entifix-ts-jwt-client` — `TokenServiceTag`'s jose-backed **RS256** adapter
  (`TOKEN_ALGORITHM`; sign/verify short-lived access tokens). `verifyAccessToken`
  pins `algorithms: ['RS256']`, which is the security boundary: jose otherwise
  trusts the token's own `alg` header and the openly-served public key would pass
  as an HMAC secret.
- `entifix-react-controls` / `entifix-react-integration` — UI primitives +
  Effect-aware hooks. `entifix-style` — design tokens.
- `entifix-ts-testing-unit` — doubles, driver fakes and port contract suites for
  unit specs. `entifix-ts-testing-e2e` — the e2e layer: the `E2E_PROFILE`
  (`mock` | `live`) seam, a mock backend built from the production query
  pipeline, and the Playwright/Vitest presets. Both are test-only and private.

**Delivery** (`packages/implementation/*`, `packages/shells/*`):

- `packages/implementation/*` holds no project today. It existed for entity-tight
  React organisms, and `makeEntityCrud` derives those from entity metadata now;
  the layer stays declared for the first component that cannot be derived.
- `shells-next-marketplace`, `shells-next-marketplace-admin`, `shells-next-auth`,
  `shells-next-system-management` (`scope:shared`, so a second host can mount it
  with no moves), `shells-next-common` and `shells-next-i18n` — Next pages +
  client adapters. `shells-effect-service` — the backend base.

**Apps** — frontends `marketplace-app` (`:3000`, the public storefront) and
`back-office-app` (`:3001`, which mounts `shells-next-marketplace-admin` **and**
`shells-next-auth`, so the catalog, system management, user administration and the
account surface share one origin); backends `marketplace-service` (`:3100`),
`marketplace-admin-service` (`:3101`, co-deploying the `transaction` slice),
`auth-service` (`:3102`) and `config-service` (`:3190`); plus `*-e2e` projects.
Six deployments in total. **marketplace-service** owns the `published-catalog`
projection and the `catalog-reference` vocabulary and serves them read-only —
a public read path that never opens a tenant connection. The storefront shell is
still **fixture-backed** and has not been pointed at it yet
(`shells-next-marketplace/src/server.ts`: "the same call sites once
marketplace-service exists"); that wiring is the remaining step, not a missing
service.

**Utils** — `utils-ts-{array,date,object,type}`.

For Nx specifics, file layout, commands, and conventions see
[DEVELOPING.md](./DEVELOPING.md). For the client side (design system + workspace
tabs) see [FRONTEND.md](./FRONTEND.md).
