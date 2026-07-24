# Developing (workspace, conventions, testing)

How the repo is wired (Nx + pnpm), how to run and test it, and the conventions a
change must follow. Architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md); the
entity framework in [ENTIFIX.md](./ENTIFIX.md); the client side in
[FRONTEND.md](./FRONTEND.md).

## File structure

```
apps/
  <domain>-app/            Next.js frontend (App Router, React 19, Tailwind)
  <domain>-service/        Effect-native backend (@effect/platform)
  config-service/          Postgres-backed configuration service
  *-e2e/                   Playwright (Next apps) / Vitest (services)
packages/
  entifix/ts/{core,business,rest-client,mongo-client,redis-client,amqp-client,jwt-client,posthog-client}
  entifix/ts/{transactions,tooling}                     CQRS transactions / OTel logging+tracking
  entifix/ts/{testing-unit,testing-e2e}                 test libraries (private)
  entifix/react/{controls,integration}                  React side of the framework
  entifix/style/                                        design tokens (CSS-only)
  business/ts/<domain>/     pure entities + use-cases (no framework)
  implementation/<domain>/react/   React organisms for a domain
  shells/next/<shell>/      Next pages + client adapters
  shells/effect/service/    shared backend base (makeService, config helpers)
  utils/ts/{array,date,object,type}   generic helpers
infra/local/                minikube platform (MongoDB, Redis, Postgres, Zitadel, otel-lgtm)
docs/                       this documentation
nx.json  tsconfig.base.json  pnpm-workspace.yaml  package.json (root)
```

### Workspace resolution: the `@r10c/source` condition

`tsconfig.base.json` sets `customConditions: ['@r10c/source']`, and every library's
`package.json` `exports` maps `.` → `@r10c/source: ./src/index.ts` (plus the built
`dist` for external consumers). So **inside the workspace, imports resolve to each
package's `src/index.ts`** — no rebuild needed between dependent libraries during
dev/typecheck. When you add a library, mirror this `exports` shape or cross-package
imports won't resolve in dev.

Type declarations come from the inferred `@nx/js/typescript` `build`/`typecheck`
targets driven by each project's `tsconfig.lib.json` (composite project
references; root `tsconfig.json` lists every member — keep it updated, or run
`pnpm nx sync`). Library builds use `@nx/js:swc` (TS-only libs) or Rollup (React
libs); services use webpack.

## Common commands

The full command reference (dev, build, typecheck, lint, test, e2e, affected, graph)
is the single source in [_shared/commands.md](_shared/commands.md) — the same block
`CLAUDE.md` imports. The essentials:

```sh
pnpm nx run <artifact>:dev            # unified dev convention for every app/service
pnpm nx build|typecheck|lint|test <project>
pnpm nx affected -t lint,build,test   # what pre-commit runs against origin/main
pnpm nx run-many -t test --coverage   # the 100% gate on every packages/* project
pnpm nx show projects | graph         # explore the workspace
```

## Dev targets & dependency orchestration

- Backend `dev` targets are `continuous` (`@nx/js:node`) and `dependsOn`:
  - `build`
  - `ensure-infra` — runs `infra/local/ensure.sh`, which checks that the MongoDB
    (`:30017`) and Postgres (`:30432`) NodePorts answer and applies the infra
    manifests if not. It does **not** auto-`minikube start` (the `--ports` mapping
    must be set at cluster create).
  - the Mongo services additionally depend on `@r10c/config-service:dev` (their
    config source), started as an Nx continuous dependency.
- Frontends already carry `dev`; `dev-w-deps` starts an app together with its
  backends.
- An inferred `serve` target still exists on the webpack apps (from the
  `@nx/webpack` plugin) but `dev` is the canonical one used everywhere.

## Local infrastructure

`infra/local` is a minikube platform (MongoDB, Redis, PostgreSQL, Zitadel, and
`otel-lgtm`) as per-platform kustomize folders. Secrets are never committed: a
`secretGenerator` reads a git-ignored `.env` (committed `.env.example` holds
LOCAL DEV ONLY defaults). Bring it up:

```sh
minikube start --ports 30017:30017,30379:30379,30672:30672,31672:31672,30432:30432,30080:30080,30000:30000,30317:30317,30318:30318
infra/local/apply.sh    # or let a backend `dev` target's ensure-infra do it
```

NodePorts follow `30000 + canonical port`: Mongo `30017`, Redis `30379`,
Postgres `30432`, Zitadel console `30080`. **`otel-lgtm`** (the local
OpenTelemetry backend — Collector + Loki + Grafana + Tempo + Prometheus) exposes
Grafana at `30000` and OTLP at `30317`/`30318`. Host-run `dev` services export
telemetry straight to `http://127.0.0.1:30318`; open Grafana at
`http://localhost:30000` (anonymous admin) to see logs/traces.

## Adding a project

Prefer the Nx generators, then mirror the workspace conventions (`@r10c/source`
exports, `tsconfig.lib.json`, add to root `tsconfig.json` references) — and **tag
the project** in its `package.json` `nx.tags` (see [Module boundaries](#module-boundaries)):

```sh
pnpm nx g @nx/next:app <name>-app
pnpm nx g @nx/react:lib <name>
```

Adding a **domain** = next port index → `300N`/`310N`, plus a seed row in
`apps/config-service/src/db.ts`. See [Adding an entity across the layers](#adding-an-entity-across-the-layers).

---

## Golden rules

1. **Dependencies point downward only.** `apps → shells → implementation → business → entifix → utils`.
   Never import upward (e.g. an `entifix` package importing from `business` or
   `shells`). The lint rule fails the build; if you feel the need to break it,
   the design is wrong — pass the dependency in as an argument or a `Context.Tag`.
2. **Use-cases stay framework-free.** Anything in `business/ts/*` must import only
   contracts (`entifix-ts-business`) and Effect — never a transport, a React hook,
   or `@effect/platform`. If a use-case needs something, it _yields a `Context.Tag`_;
   the composition root provides it.
3. **Inject with Effect, don't pass instances.** Wire new dependencies as
   `Context.Tag` subclasses and provide them via `Layer` / `Effect.provideService`.
   A missing dependency should be a compile error, not a runtime one.
4. **Adapters are generic.** An adapter derives everything from entity metadata
   (`extractMetaEntity(Ctor).key`, `extractMetaAccessors(Ctor)`) and the shared
   (de)serializer. Don't hand-write per-entity mapping; if metadata can't express
   something, extend the decorators, not the adapter.

## Module boundaries

The golden rule above is **enforced**, not just reviewed. Every project declares
`nx.tags` in its `package.json`, and `eslint.config.mjs` turns those tags into
`@nx/enforce-module-boundaries` constraints across three dimensions:

| Dimension   | Tags                                                                                     | Rule                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **layer**   | `layer:app` › `shell` › `implementation` › `business` › `entifix` › `utils`              | depend only on layers **below**                                          |
| **scope**   | `scope:{marketplace, marketplace-admin, auth, transaction, config, shared}`              | a domain may depend only on itself or `scope:shared` (the reusable core) |
| **entifix** | `entifix:core` ‹ `contract` ‹ {`tooling`, `style`} ‹ `transactions` ‹ `client` ‹ `react` | internal ordering inside the entifix layer                               |
| **type**    | `type:testing`, `type:e2e`                                                               | spec files may import `type:testing` libs; source files may not          |

The rule ANDs every constraint a project's tags match, so the dimensions compose.
Consequence: **to make an edge legal, retag the project — never relax the rule.**
Adding a new project without tags leaves it on the permissive `*` catch-all; give
it the right `layer:`/`scope:` (and `entifix:` if it lives under `packages/entifix`).
Verify with `pnpm nx run-many -t lint`.

## Entities

- Private fields use `#name`; expose them through `@accessor()`-decorated
  getters/setters so `MetaEntity` introspection works. A field without an
  `@accessor()` getter is invisible to adapters.
- Give every entity a kebab-case `key` (`@entity({ key: 'product-brand' })`). The
  key is the REST route **and** the Mongo collection name — keep them aligned.
- Model relations with `EntityLink` / `EntityCollectionLink`, initialized in the
  constructor, exposed via a read-only `@accessor()` getter (no setter). The
  deserializer populates them in place.
- Entity packages must ship a **stage-3 `.swcrc`** (`decoratorVersion: "2022-03"`,
  no `legacyDecorator`). The same applies to `.spec.swcrc` if the package has
  tests that construct entities — a legacy-decorator spec miscompiles `@entity`
  and throws at runtime.

## Adding an entity across the layers

1. **Define** it in `business/ts/<domain>` — `@entity`/`@accessor`, links as
   `EntityLink`. Reuse an existing use-case factory (`loadUCFactory`, `getUC`, …)
   unless the flow is genuinely new.
2. **Organism** — a React component in `implementation/<domain>/react` that runs
   the UC with `useDataLoading`.
3. **Page** — wire the adapter(s) and any link resolver in `shells/next/<shell>`
   (the page is the composition root).
4. **Backend route** — in the `-service`, provide `makeMongoRepository(db, Ctor)`
   for `EntityRepositoryTag` and serialize the result.
5. **Config** — if it introduces a new service/URL, add a seed row in
   `apps/config-service/src/db.ts`; never hardcode a URL or connection string.

## Backends

- Compose `@r10c/shells-effect-service`; keep the service thin (routes + an
  `AppLayer`). Health and shutdown come from the base.
- Resolve runtime config from config-service at boot (`loadRemoteConfiguration`),
  never from ad-hoc `process.env` beyond a single bootstrap value (e.g.
  `CONFIG_API_URL`, `CONFIG_PG_URL`).
- Any secret in a diagnostic response must be run through `redactConfiguration` /
  `redactValue`.
- Add native drivers (`mongodb`, `@effect/sql*`) to the service's
  `webpack.config.js` `externalDependencies`, and externalize `tslib`.
- Keep DB driver / `@effect/sql` versions aligned with the pinned
  `@effect/platform` — mismatched peers break `pnpm install` (see [[backend-db-connectivity]]).

## Testing

One runner: **Vitest**, configured once in `vitest.shared.mts`. Every project's
`vitest.config.mts` is a few lines calling `defineEntifixTest`. Decorators are
compiled by `unplugin-swc` because Vite's oxc backend does not implement
stage-3 decorators, and entity metadata depends on them.

Every `packages/*` project is gated at **100%** statements, branches, functions
and lines. Apps are excluded — their `*-e2e` projects cover them. The shared
exclusion list lives in `vitest.shared.mts`; adding to it needs a stated
reason, otherwise the gate erodes. A genuinely unreachable defensive branch
gets `/* v8 ignore next */` plus a comment saying why, not a contorted test.

```sh
pnpm nx test <project> --coverage
pnpm nx run-many -t test --coverage
```

### Which double to reach for

The kind of double is decided by where it lives, in
`@r10c/entifix-ts-testing-unit`:

| Kind               | What it is                                                 | Where                  |
| ------------------ | ---------------------------------------------------------- | ---------------------- |
| **Stub**           | Canned answers, nothing asserted on it                     | inline, or `makeStub*` |
| **Fake**           | Working in-memory implementation of a driven port          | `.` (`makeInMemory*`)  |
| **Driver fake**    | Fake of a _third-party client_, one level below an adapter | `./drivers`            |
| **Recording fake** | A fake that records what happened, asserted as state       | `.` (`makeRecording*`) |
| **MSW**            | The boundary for everything HTTP                           | `./http`               |

Prefer a recording fake over a mock with call assertions: `expect(bus.published)`
reads as state, a spy protocol does not. Mocks are for the cases where the
behaviour _is_ the interaction — event publication, lock ordering, rollback.

**Driver fakes, not port fakes, for adapters.** A fake at the port level
replaces the adapter, so the filter translation, the `SET NX PX`, the envelope
framing and the error mapping all go unmeasured while coverage still reports
the port as exercised. The driver fakes sit one level lower so the real adapter
runs against them.

**No HTTP without MSW.** `setupEntifixServer` sets `onUnhandledRequest: 'error'`
— a request nobody stubbed fails the test instead of escaping to the network.
No spec assigns `global.fetch`.

**Contract suites.** Each driven port has one suite in `./contracts`, run
against _every_ implementation: the in-memory fake and the real adapter over
its driver fake. That is what stops a fake from quietly becoming a more
forgiving version of the thing it stands in for.

Two packages cannot use the test library: `entifix-ts-business` and
`entifix-transactions` define the interfaces it is built on, so depending on it
from them is a cycle. They keep local doubles.

Elsewhere, add it as a `devDependency`, then `pnpm install` and `pnpm nx sync`.

### E2E and `E2E_PROFILE`

E2E suites run in one of two profiles, selected by `E2E_PROFILE` and provided by
`@r10c/entifix-ts-testing-e2e`:

| Profile          | What is real                           | Infra | Where              |
| ---------------- | -------------------------------------- | ----- | ------------------ |
| `mock` (default) | the app / service under test           | none  | every pull request |
| `live`           | everything, down to Mongo and RabbitMQ | yes   | locally, on demand |

```sh
pnpm nx e2e marketplace-admin-app-e2e                       # mock
pnpm nx e2e marketplace-admin-service-e2e                   # mock

pnpm nx run marketplace-admin-service:dev                   # then, in another shell:
E2E_PROFILE=live MARKETPLACE_ADMIN_SERVICE_URL=http://localhost:3101 \
  pnpm nx e2e marketplace-admin-app-e2e
```

`mock` is the default because the default has to run anywhere. `live` never
falls back: a missing target URL **throws**, because a suite that skips itself
reports green for a run that tested nothing.

**`mock` is not a stub of the answers.** For an app suite the browser talks to
msw handlers (`@msw/playwright`, over `page.route()` — nothing is added to the
application bundle) backed by `makeEntityBackend`, which is assembled from the
production query pipeline: `parseLoadRequestParams` → `loadUCFactory` →
`makeMongoRepository` → the fake Mongo driver. For a service suite,
`serveTestService` boots the service's **real router** through the real
`makeServerLayer` on an ephemeral port, with only the connection Layers replaced
by driver fakes. Both profiles therefore agree on filtering, sorting, paging and
the `400` the metadata allowlist produces — which is what lets one spec suite
serve both.

**Spec layout.** Selection is by filename, enforced by the config presets
(`testIgnore` for Playwright, `exclude` for Vitest) — never by an in-spec
`test.skip`, so a run with the wrong environment fails loudly:

```
<journey>.spec.ts        profile-agnostic — runs in BOTH profiles
<journey>.mock.spec.ts   mock-only: wire assertions, injected failures
<journey>.live.spec.ts   live-only: real infra, seeded data
```

Put a journey in `*.spec.ts` unless it _cannot_ run in both.

**Asserting emitted telemetry.** Because `serveTestService` runs the real
`AppLayer`, a service can merge an observability layer built with **in-memory
exporters** and assert on what it emitted. `marketplace-admin-service` exports
`makeInMemoryObservabilityLayer(serviceName)` (real logger replacement + OTel
tracer, in-memory sink + span exporter); the mock `mock-service.ts` merges it and
re-exports `capturedLogRecords`/`capturedSpans`, and `logging.mock.spec.ts`
asserts a request produces a structured record carrying its span's `trace_id`.
It is a `*.mock.spec.ts` because it reads an in-process sink; the same guarantee
against real infra is checked by hand (logs in Loki, the trace in Tempo).

**Resolution.** Every `e2e` target gets `NODE_OPTIONS=--conditions=@r10c/source`
from `nx.json`. Vitest applies that condition itself, but Playwright resolves
specs with plain Node and would otherwise land on a package's `dist/` — which
works on a machine with a stale build and fails on a clean checkout.

## Code style

- Match the surrounding code: comment density, naming, and idiom. Comments
  explain **why**, not what.
- Run `pnpm nx lint <project> --fix` before pushing (import sort is enforced).
- After adding a cross-package dependency, run `pnpm nx sync` so tsconfig project
  references stay consistent (the typecheck target will otherwise complain the
  workspace is out of sync).
- Reuse `utils-ts-*` helpers rather than re-implementing array/date/object logic.

## Verifying a change

- Static: `pnpm nx affected -t lint,build,typecheck,test` (or `run-many` on the
  touched projects). This is also what pre-commit runs.
- Coverage: `pnpm nx run-many -t test --coverage` — every `packages/*` project
  must stay at 100%.
- Runtime: bring up `infra/local`, then `pnpm nx run <service>:dev` and exercise
  the routes (`/api/health`, `/api/config`, the entity routes). For frontends,
  drive the `/catalog/*` pages.

## Commits & PRs

- **Conventional Commits with Nx scopes** (`@commitlint/config-nx-scopes`) — the
  scope is the project name: `feat(entifix-ts-mongo-client): add filter translator`.
  Enforced by commitlint.
- `.husky/pre-commit` runs `lint-staged` then
  `pnpm nx affected -t lint,build --base=origin/main` (it `git fetch`es first, so
  origin must be reachable).
- Branch off `main`; keep changes within the layer boundaries.
- Do **not** add AI/tool co-author trailers or "generated with" lines to commits,
  PRs, or docs.
