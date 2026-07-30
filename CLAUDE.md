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
| [docs/I18N.md](docs/I18N.md)                 | Locales, catalogs, locale routing, entity label keys, error codes, and the three gates that make i18n mandatory.                    |
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
- **A library edit reloads everywhere, by two different mechanisms.** A `-service`
  consumes workspace packages as **source** via `resolve.conditionNames`
  (`@r10c/source`) in its `webpack.config.js`, and `@nx/js:node` rebuilds and
  restarts it on a dependency edit. The Next apps **cannot** declare that
  condition — Turbopack has no `conditionNames` knob and Next's swc only parses
  decorators in the legacy `experimentalDecorators` emit, which would break the
  stage-3 `Symbol.metadata` entity decorators — so they resolve `import` →
  **`dist`**, and `tools/watch-libs.sh` keeps `dist` fresh: **one** watcher
  (`watch-libs` on the root project, `dependsOn` of every app `dev`, so Nx dedupes
  it to a single process) rebuilds the changed library in ~3-5s and Turbopack
  picks it up. Per-app `watch-deps` is what you must NOT wire — `marketplace-admin-app:dev`
  chains `auth-app:dev`, so two watchers double-build every shared library. A
  manual `pnpm nx build <lib>` is only needed when no app is running. Service `build`
  targets must keep **`dependsOn: []`**: with the inferred `^build`, every
  rebuild forked `nx run <service>:build`, re-entered a lib build already in the
  parent chain, and Nx killed the service with
  `Recursive task invocation detected`. `^production` in `inputs` is what keeps
  the cache honest, not `^build`.
- **Liveness never checks a dependency.** Every app and service answers
  `/api/health` (unchanged), `/api/health/live` and `/api/health/ready`.
  Liveness is process-only _by design_ — a liveness probe that fails on a Mongo
  blip is how Kubernetes gets told to restart a healthy fleet. Readiness is
  `200` / `503 {status:'degraded',failing:[…]}` with probe **names** only (the
  endpoint is unauthenticated), cached ~1s so it cannot become a free lever on
  the datastore, and each probe is deadlined in the registry — a driver that
  queues while disconnected (ioredis) otherwise leaves readiness _hanging_ at
  the one moment it must answer. Backend probes register themselves from the
  client layers (`MongoHealthProbeLayer` &co. + `HealthRegistryTag` from
  `@r10c/entifix-ts-business`), so a service that gains a datastore gains its
  probe; a service `AppLayer` merges the probe layer, `makeServerLayer`
  provides the registry. App readiness checks **only** its own config — never
  chain to a backend, that turns one degraded service into a fleet outage.
- **Dev ports self-clear.** Every app/service `dev` depends on `free-ports`
  (`tools/free-ports.sh <port>`), which kills a leftover listener from a previous
  run — but **only** a process running from inside this repo (cwd/argv under the
  repo root); a foreign listener is reported and the target fails rather than
  killing something that is not ours (`R10C_FREE_PORTS=force` overrides). Ports
  live in `ALL_PORTS` there and in [ports](docs/_shared/ports.md); a new domain
  adds its `300N`/`310N` to both.
- **Local dev self-heals.** `pnpm run mp-admin:dev` walks the ladder in
  `infra/local/ensure.sh` (cluster → port mapping → workloads → rollout → probes)
  and fixes the broken rung; it never deletes data and never recreates the
  cluster, exiting with the `reset.sh` command instead.
  `pnpm run mp-admin:dev:reset` is the destructive heal — it wipes the
  namespace, PVs **and** hostPaths so the services re-seed on boot, which is
  the only way a drifted seed row gets corrected (the seed is
  `INSERT … ON CONFLICT DO NOTHING`). Ports/namespace/probes live once in
  `infra/local/lib.sh`. A published NodePort answering TCP is **not** health —
  docker-proxy keeps it open with no pod behind it — so probes are always paired
  with deployment readiness. `pnpm run dev-infra:doctor` diagnoses read-only.
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
  `absoluteExpiresAt`. What slides a session is _user_ activity: `requirePrincipal`
  must stay stateless, so the browser's `useSessionRefresh` stops refreshing when
  idle rather than the server reading Redis per request. The shared route handler
  is `createRefreshRoute` from **`@r10c/shells-next-common/server`** — anything a
  route handler or server layout _calls_ must ship from `/server`, so it is never
  reached through the client surface and stamped as a client reference.
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
  redeemed with `GETDEL`. Change-password revokes all _other_ sessions; reset
  revokes _all_. Lockout answers `429`, is keyed identifier+source, auto-expires,
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
  the Next shells. TanStack Query **wraps** Entifix (never replaces it), and TanStack
  Form backs `useEntityForm` behind a plain `values`/`errors`/`setField`/`submit`
  facade so `EntityForm` stays library-agnostic. Entity validation composes
  metadata → Standard Schema → caller callback; a schema is written against the
  **string draft** and its messages are **catalog keys**, never sentences. See
  [docs/FRONTEND.md](docs/FRONTEND.md), [[design-system-theme]], [[layout-primitives-decision]],
  [[workspace-tabs-design]].
- **A workspace library is compiled per-file, never bundled.** Every library under
  `packages/` builds with `@nx/js:swc` — there is no rollup or vite config left in
  `packages/`, and adding one back reopens three bugs at once. Bundling **merges
  modules**, so rollup silently drops each file's `"use client"` (only a bundle-wide
  `output.banner` survives, which is all-or-nothing and cannot describe a mixed
  client/server surface); it **absorbs CommonJS deps**, emitting an interop helper
  that reads `typeof require` and throws `dynamic usage of require is not supported`
  against a Next server runtime (Turbopack is not the culprit —
  `serverExternalPackages`/`transpilePackages` cannot fix a shim baked in before Next
  resolves anything); and it **writes the same `dist/` that `tsc --build` owns**,
  which is [#27](https://github.com/r10c-technologies/r10c/issues/27). Per-file swc
  has none of these: each module keeps its own directive, nothing is inlined, and
  `dist` has exactly two writers with disjoint file sets — swc emits `.js`/`.js.map`,
  `tsc` emits `.d.ts`/`.d.ts.map`/`.tsbuildinfo`.
- **`@nx/js:swc` runs `tsc` even with `skipTypeCheck: true`.** The executor's guard is
  `skipTypeCheck && !isTsSolutionSetup`, and this repo _is_ a TS solution setup, so the
  declaration pass always runs — with `ignoreDiagnostics: true`. Its errors are
  therefore **invisible**, while `noEmitOnError` (from `tsconfig.base.json`) still
  blocks the emit. A library whose `tsconfig.lib.json` overrides `lib` and drops what
  the base provides (`decorators`/`esnext.decorators`, needed by `Symbol.metadata` in
  `entifix-ts-core`) or omits `dom` produces a green build with **zero `.d.ts`** — and
  the poisoned `.tsbuildinfo` then makes the next `tsc --build` report a `TS6305`
  cascade. When overriding `lib`, extend the base list, never replace it. To see what
  the pass is hiding: `pnpm nx build <lib> --skipTypeCheck=false`.
