# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. This file is a
**router**: the operational essentials below are `@import`ed from single-source
snippets in `docs/_shared/` (so they can never drift from the docs that also use
them), and everything deep is a link — loaded only when a task needs it.

## Documentation map

| Doc                                          | When you need it                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, the use-case + adapter mechanism, Effect-native backends, auth, transactions, observability, domain structure.            |
| [docs/ENTIFIX.md](docs/ENTIFIX.md)           | The entity framework in depth: entities, links, the Effect-agnostic use-case, adapter contract, the RSQL query protocol.            |
| [docs/FRONTEND.md](docs/FRONTEND.md)         | The client side: design system (tokens, flex-first layout primitives, Storybook) **and** the workspace tabs + TanStack data layer.  |
| [docs/DEVELOPING.md](docs/DEVELOPING.md)     | Nx/pnpm workspace, commands, local infra, **module boundaries**, entities, backends, testing (`E2E_PROFILE`), conventions, commits. |
| [docs/adr/](docs/adr/)                       | Architecture Decision Records (e.g. [0001 observability & tooling](docs/adr/0001-observability-and-tooling.md)).                    |

`docs/_shared/` holds the small snippets imported below; edit the snippet, not the copies.

## Tooling & commands

@docs/_shared/commands.md

## Layering & module boundaries

@docs/_shared/layering.md

## App & port convention

@docs/_shared/ports.md

## Notes for code changes

- **Boundaries are enforced.** Imports must point downward and stay in-scope; the
  `@nx/enforce-module-boundaries` rule (driven by each project's `nx.tags`) fails
  the build otherwise. A new project needs `layer:`/`scope:` (and `entifix:` under
  `packages/entifix`) tags. To make an edge legal, retag — never weaken the rule.
  See [DEVELOPING.md → Module boundaries](docs/DEVELOPING.md#module-boundaries).
- **Inject with Effect.** Wire dependencies as `Context.Tag` subclasses provided via
  `Layer`, not instances through constructors — a missing dep is a compile error.
- **Entities describe themselves.** Private `#field` + `@accessor()` getter/setter
  (a field without a getter is invisible to adapters). Pass `type`/`label` (and
  `sortable`/`filterable`/`hidden` where they differ from defaults). A member's
  `filterable`/`sortable` metadata is also the **server-side allowlist** — a query
  naming a member that lacks it is rejected `400`, so making a member queryable is a
  one-line change on the entity and nowhere else. See [docs/ENTIFIX.md](docs/ENTIFIX.md).
- **Adding a filter operator** touches three places or it half-works: the const
  arrays in `core/types/EntityFiltering.ts`, the token map in
  `core/src/rsql/rsql-operators.ts`, and `mongo-client`'s `filter-translator.ts`.
  The core round-trip spec (`serialize → parse → coerce` equals the original) catches
  a partial addition.
- **Backend DB adapters**: a `-service` provides `EntityRepositoryTag` from
  `makeMongoRepository(db, Ctor)`, runs the SAME `*UCFactory` use-cases, then
  `serializeEntity`/`serializeEntityCollection` for the response. Add native drivers
  (`mongodb`, `@effect/sql*`) to `webpack.config.js` `externalDependencies`, keep
  `tslib` external, and align `@effect/sql*` with the pinned `@effect/platform`. See
  [[backend-db-connectivity]] and [docs/ENTIFIX.md](docs/ENTIFIX.md).
- **Config**: services read cross-service config from **config-service** (Postgres,
  seeded in `apps/config-service/src/db.ts`); never hardcode a URL/connection string.
  Every service exposes `GET /api/config` (own params, secrets redacted via
  `redactConfiguration`).
- **Transactions**: a `-service` with transactional writes provides the ports from the
  Redis/AMQP layers in its `AppLayer` and resolves `redis.uri`/`rabbitmq.uri` from
  config-service; add `ioredis`/`amqplib` to `externalDependencies`. The domain half is
  a `TransactionHandler` closing over its deps. See [[entifix-transactions-phase1]] and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#transactions-cqrs-writes).
- **Auth**: auth-service owns `register`/`login`/`logout`/`refresh` and returns JSON;
  each `-app` mints its own `r10c_sid`/`r10c_at` httpOnly cookies. A backend authorizing
  a request verifies `r10c_at` statelessly via `TokenServiceTag` (no Redis/auth round
  trip on the hot path). See [[auth-layer-v1]] and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#auth-sessions--tokens).
- **Observability**: a `-service` merges an observability layer that replaces Effect's
  default logger with the `@r10c/entifix-ts-tooling` logger and stands up the
  `@effect/opentelemetry` NodeSdk tracer, reading `logging.*`/`otel.endpoint` from
  config-service (`marketplace-admin-service/src/observability.ts` is the reference).
  See [ADR 0001](docs/adr/0001-observability-and-tooling.md) and [[observability-stack-decision]].
- **Frontend**: agnostic UI in `@r10c/entifix-react-controls` + tokens in
  `@r10c/entifix-style`; layout is flex-first (Every Layout, no media queries) with
  `Grid` the single CSS-Grid escape hatch. Page shells compose primitives and live in
  the Next shells. TanStack Query **wraps** Entifix (never replaces it). See
  [docs/FRONTEND.md](docs/FRONTEND.md), [[design-system-theme]], [[layout-primitives-decision]],
  [[workspace-tabs-design]].
