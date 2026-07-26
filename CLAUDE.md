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
| [docs/I18N.md](docs/I18N.md)                 | Locales, catalogs, locale routing, entity label keys, error codes, and the three gates that make i18n mandatory. |
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
- **Sessions slide under a ceiling.** Every duration lives in
  `business-ts-authn/values/session-policy.ts` — edit there, nowhere else. Both
  cookies are sized to the **session**, never to the token (sizing `r10c_at` to
  `expiresIn` is what signed everyone out every 15 min). `touch` clamps to
  `absoluteExpiresAt`. What slides a session is *user* activity: `requirePrincipal`
  must stay stateless, so the browser's `useSessionRefresh` stops refreshing when
  idle rather than the server reading Redis per request. The shared route handler
  is `createRefreshRoute` from **`@r10c/shells-next-common/server`** — that subpath
  exists because rollup stamps `"use client"` on the main bundle, so anything a
  route handler or server layout *calls* must ship from `/server`.
- **Account surface** is auth-app's alone; other apps link across via `AccountMenu`
  with the locale baked into the absolute URL (`localeHref` leaves absolute URLs
  alone). `/account/*` lives outside `(back-office)`, which demands
  `authn:user-identity:read` — a plain `user` must still reach their own account.
- **Devices are labels, never authorization inputs.** `r10c_did` + `userAgent()`
  from `next/server` (no new dep; avoid `ua-parser-js` v2, it is AGPL). History is
  durable in Mongo so a familiar browser is not announced as new after its sessions
  expire. Admin session control is behind `authn:user-device:read|write`.
- **Recovery**: the reset link exists in the notification and **never** in a
  response body; `forgot` always answers `202` (enumeration). Tokens are hashed and
  redeemed with `GETDEL`. Change-password revokes all *other* sessions; reset
  revokes *all*. Lockout answers `429`, is keyed identifier+source, auto-expires,
  and notifies once. In dev, notifications land in `GET /api/dev/outbox`, which
  404s in production — that route is what makes the reset flow e2e-testable.
  See [ADR 0004](docs/adr/0004-session-lifetime-devices-and-recovery.md).
- **Authorization**: a permission is `<domain>:<entityKey>:<action>`, derived from the
  entity's own `@entity({domain,key})` (`permissionForEntity`); grants come from
  `ROLE_PERMISSIONS` in `@r10c/business-ts-authz`, never from the token, which still
  carries only `roles`. Guard a route with `requirePermission(...)` from
  `@r10c/shells-effect-service` (401 vs 403) — **hiding a nav item protects nothing**.
  `PolicyDecisionTag` is the ABAC seam; `canAssignRole` caps role creation at the
  actor's own tier. Creating a user always runs `registerUserUCFactory`, never a
  generic entity write. `unverifiedRoles` reads the cookie **without checking its
  signature** — nav filtering only, never a decision. Gated Next apps need a
  `seedSession` e2e fixture and a `readyPath` outside the matcher. See
  [ADR 0002](docs/adr/0002-authorization-roles-and-abac.md) and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#authorization-role-aspects--permissions).
- **i18n is mandatory.** Ships `es` (default) + `en`. Copy goes through `useT`
  (`getServerT` on the server), typed against the catalogs in
  `@r10c/entifix-ts-i18n` — a bad key is a compile error, and
  `react/jsx-no-literals` fails the build on a string written into JSX. Locale is
  a URL prefix resolved by middleware (`@r10c/shells-next-i18n`) and
  read via `getRequestLocale()`; **every internal href goes through `LocaleLink`
  / `useLocaleHref()`**. Entity labels are `labelKey`/`enumLabelKey` metadata
  resolved in the browser (they never cross the wire). Services answer
  `{ error, code, detail }` and the client renders `code`. Runtime keys use the
  two documented escape hatches (`useTranslateKey`/`getServerTranslateKey`) —
  authored copy must not. Note lint is blind to copy inside JSX expressions like
  `{saving ? 'Saving…' : 'Save'}`. See
  [ADR 0003](docs/adr/0003-i18n-mandatory.md) and [docs/I18N.md](docs/I18N.md).
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
