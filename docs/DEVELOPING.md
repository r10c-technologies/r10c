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

Declaring the condition is not the same as consuming it: TypeScript, Vitest,
Storybook and the service webpack all opt in, the Next apps cannot (they resolve
`dist`, kept fresh by a watcher — see
[Library edits](#library-edits-reload-everywhere-two-mechanisms)).

Type declarations come from the inferred `@nx/js/typescript` `build`/`typecheck`
targets driven by each project's `tsconfig.lib.json` (composite project
references; root `tsconfig.json` lists every member — keep it updated, or run
`pnpm nx sync`). **Every** library builds with `@nx/js:swc` — React libraries
included, compiled per-file and never bundled (see
[How a library is built](#how-a-library-is-built)); services use webpack and the
Next apps use `next build`.

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
  - `free-ports` — runs `tools/free-ports.sh <port>`, clearing a leftover
    listener from a previous run (an nx task SIGKILLed, a closed terminal that
    orphaned `next dev`) before this one binds. Every app and service has it, so
    each clears only its own port. It kills a process **only** when that process
    runs from inside this repo (its cwd or command line is under the repo root);
    anything else — your other project on `:3000`, a system daemon — is reported
    and the target fails instead, since it is not ours to kill. Override with
    `R10C_FREE_PORTS=force`. `pnpm run dev-ports:free` sweeps every fleet port at
    once.
  - `build`
  - `ensure-infra` — runs `infra/local/ensure.sh`, the self-heal ladder: it
    starts a stopped minikube, applies missing manifests, waits out a rollout,
    and restarts a wedged pod once. Healthy costs ~0.1s, so running it 3-4×
    per boot is free. It heals nothing destructive — no data is deleted and the
    cluster is never recreated; it exits naming `reset.sh` for those.
  - the Mongo services additionally depend on `@r10c/config-service:dev` (their
    config source), started as an Nx continuous dependency.
- An inferred `serve` target still exists on the webpack apps (from the
  `@nx/webpack` plugin) but `dev` is the canonical one used everywhere.

### Library edits reload everywhere (two mechanisms)

Edit anything under `packages/**/src` while an app or service is running and the
change reaches the browser (or the restarted service) on its own — nothing to run
by hand. The two sides get there differently:

- **Services** — the service webpack sets
  `resolve.conditionNames: ['@r10c/source', …]`, so it bundles library
  **source**; `@nx/js:node` watches the project _and its dependencies_ and
  rebuilds + restarts (~5s).
- **Frontends** — the Next apps resolve `@r10c/source` → `import` → **`dist`**, and
  `tools/watch-libs.sh` keeps `dist` in step with `src`: it rebuilds the changed
  library (~3s for a small one, ~5s for `shells-next-common`) and Turbopack then
  hot-reloads the app. It is the root `watch-libs` target, a `dependsOn` of every
  app's `dev`, so it starts with the app and dies with it.

**Why the apps do not consume source** (asked and answered in
[#34](https://github.com/r10c-technologies/r10c/issues/34) — don't reopen it without
new facts): Next 16's `turbopack` config accepts only `resolveAlias` /
`resolveExtensions`, with no `conditionNames` knob; and Next's swc enables decorators
**only** when tsconfig sets `experimentalDecorators`, i.e. the _legacy_ emit, while
the entity framework uses stage-3 decorators writing to `Symbol.metadata`. Feeding
`entifix-react-controls` or `business-ts-authz` source through Turbopack therefore
either fails to parse or yields entities with no metadata. `withNx` cannot help
either: it derives `transpilePackages` from `tsconfig.base.json` `paths`, and this
workspace has none.

**One watcher, not one per app.** `watch-libs` lives on the **root** project and is
watched via `--projects '*,!tag:layer:app'` (every library; apps and services
excluded). Every app's `dev` depends on that same task, so Nx's task graph collapses
it to a single process — wiring the per-project `watch-deps` Nx infers instead would
give `back-office-app:dev` two watchers (it chains `auth-service:dev` and
`marketplace-admin-service:dev`) racing to
build the same shared library on one keystroke. The watcher does not chase its own
output: the Nx daemon's file watcher honours `.gitignore`, and `dist` is ignored.

Two rough edges worth knowing. A rebuild is swc emit **plus** a `tsc` declaration
pass — `@nx/js:swc` always runs it in a TS solution setup, `skipTypeCheck` only
silences its diagnostics — which is most of those seconds. And a save landing while
Turbopack is mid-read can serve a torn module; the next save clears it.
`@r10c/entifix-style` needs no rebuild at all: it has no build target, its CSS
subpaths are consumed straight from `src`.

Each app's `dev` also depends on the inferred `build-deps`, so `dist` is correct at
boot — otherwise the first page load silently serves whatever the last build left
behind. When no app is running, build the one library you edited:
`pnpm nx build <lib>`.

**Service `build` targets declare `dependsOn: []`.** The inferred default is
`^build`, and it is both useless here (the bundle inlines library source) and
actively harmful: `@nx/js:node` force-enables `runBuildTargetDependencies` for
any `nx:run-commands` build target (it needs the build event the CLI emits —
see `@nx/js/src/executors/node/node.impl`), so every rebuild forked
`nx run <service>:build`, re-entered `shells-effect-service:build` already
running in the parent chain, and Nx killed it with
`Recursive task invocation detected` → `Build failed, waiting for changes to
restart…`. The service stayed dead until the next save. Cache correctness does
not depend on `^build`: `^production` is already in the target's `inputs`, so a
library source change still invalidates the service build.

## Local infrastructure

`infra/local` is a minikube platform (MongoDB, Redis, PostgreSQL, `otel-lgtm`,
and opt-in Zitadel) as per-platform kustomize folders. Secrets are never
committed: a `secretGenerator` reads a git-ignored `.env` (committed
`.env.example` holds LOCAL DEV ONLY defaults). You should not have to bring it
up by hand:

```sh
pnpm run back-office:dev        # heals whatever rung is broken, then runs the app
pnpm run back-office:dev:reset  # recreate the datastores first (WIPES local data)
pnpm run dev-infra:doctor       # read-only ladder view + the command that fixes it
```

Reset is the answer to **bad data**, which `ensure-infra` deliberately will not
touch: it deletes the namespace, the PVs _and_ the hostPaths (a plain
`teardown.sh` leaves those, which is why a "reset" used to change nothing), so
config-service re-seeds its table and auth-service reconciles its seed
identities into an empty Mongo. `reset.sh --hard` also recreates the cluster —
the only fix for a cluster created without the `--ports` mapping, since that is
set at creation time.

**A rename is bad data.** Both seeds only write what is not already there —
config-service's rows are `INSERT … ON CONFLICT DO NOTHING`, and a collection
seed inserts only when the collection is empty — so a machine that booted before
a rename keeps every old value _and_ gains the new one, with nothing to signal
the mismatch. ADR 0022 is the worked example: `Product` became
`ProductSpecification`, so `tenant_<id>` ends up holding both `product-specification`
and a stale `product`, plus `product-brand`/`product-category` collections whose
entities moved to the `marketplace` database entirely. A corrected seed _value_
behaves the same way — the row is already there, so the fix never lands. Neither
is a code change; both are `dev:reset`, and a fresh machine needs nothing.

One trap worth knowing: with the docker driver a published NodePort keeps
accepting TCP after the pod behind it is gone, so "the port answers" is not a
health check. The ladder pairs every probe with deployment readiness.
Manifests by hand are still `infra/local/apply.sh` (Zitadel only with
`INFRA_INCLUDE_ZITADEL=1`); see [infra/local/README.md](../infra/local/README.md).

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

The generators scaffold a **bundler** config (`vite.config.ts`, or
`rollup.config.cjs` on older ones). Delete it and wire the library the way
[How a library is built](#how-a-library-is-built) prescribes — that is not a
preference, it is what keeps `dist` collision-free.

Adding a **domain** = next port index → `300N`/`310N`, plus a seed row in
`apps/config-service/src/db.ts`. See [Adding an entity across the layers](#adding-an-entity-across-the-layers).

### How a library is built

**Every** library under `packages/` compiles per-file with `@nx/js:swc` — React
libraries included. There is no `rollup.config.*` or `vite.config.ts` left under
`packages/`, and that is the invariant to preserve:

```sh
# must print nothing
find packages -name 'rollup.config.*' -o -name 'vite.config.ts' | grep -v node_modules
```

(`vitest.config.mts` is unrelated — Vitest and Storybook still use vite. Only the
**build** is bundler-free.)

#### Recipe for a new library

1. Delete the generated bundler config.
2. Add the `build` target to `package.json` under `nx.targets` (paths are
   workspace-relative — copy from `packages/entifix/react/controls/package.json`):

   ```json
   {
     "nx": {
       "tags": ["layer:…", "scope:…"],
       "sourceRoot": "packages/<path>/src",
       "targets": {
         "build": {
           "executor": "@nx/js:swc",
           "outputs": ["{options.outputPath}"],
           "options": {
             "outputPath": "packages/<path>/dist",
             "main": "packages/<path>/src/index.ts",
             "tsConfig": "packages/<path>/tsconfig.lib.json",
             "skipTypeCheck": true,
             "stripLeadingPaths": true
           }
         }
       }
     }
   }
   ```

3. Point the entry points at the **per-file** output — `./dist/index.js` and
   `./dist/index.d.ts` (`main`, `module`, `types`, and every `exports` condition).
   There is no `index.esm.js`; that name only ever came from rollup.
4. Add a `.swcrc`. Copy a sibling's; a library containing `.tsx` needs
   `jsc.parser.tsx: true` and `jsc.transform.react.runtime: "automatic"`.
   Keep the `exclude` list covering `.spec`/`.test`/`.stories` — swc compiles
   **everything** under `src`, so anything not excluded ships in `dist`.
5. In `tsconfig.lib.json`, exclude the same non-shipping files and **extend** the
   base `lib` rather than replacing it (see the trap below).

Verify with `pnpm nx build <lib> && pnpm nx typecheck <lib>` — `dist` must end up
with a matching count of `.js` and `.d.ts`.

#### Why no bundler

Bundling breaks three things at once:

| bundling does                                   | consequence                                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| merges modules into one file                    | each file's `"use client"` is **dropped**; only a bundle-wide `output.banner` survives, and it cannot describe a mixed client/server surface                                 |
| absorbs CommonJS dependencies                   | rollup emits an interop helper reading `typeof require`; against a Next server runtime that throws `dynamic usage of require is not supported`, killing any static prerender |
| writes the same `dist/` that `tsc --build` owns | the output collision behind [#27](https://github.com/r10c-technologies/r10c/issues/27) — a `TS6305` cascade of fake type errors                                              |

Per-file swc has none of these. `dist` ends up with exactly **two writers and
disjoint file sets**: swc emits `.js`/`.js.map`, `tsc --build` (the `typecheck`
target) emits `.d.ts`/`.d.ts.map`/`.tsbuildinfo`. Keep it that way — a build tool
that clears `dist` or emits its own `.d.ts` there reopens the collision. This is
also why `package.json` points at `./dist/index.js` and `./dist/index.d.ts`.

#### The declaration pass `skipTypeCheck` does not skip

`@nx/js:swc` guards its `tsc` run with `skipTypeCheck && !isTsSolutionSetup`. This
repo **is** a TS solution setup, so the declaration pass always runs — with
`ignoreDiagnostics: true`. Its errors are invisible, but `noEmitOnError` (from
`tsconfig.base.json`) still blocks the emit, so a library can build "successfully"
having written **zero `.d.ts`**, and the poisoned `.tsbuildinfo` then makes the next
`tsc --build` report a `TS6305` cascade.

The usual cause is a `tsconfig.lib.json` that **replaces** `lib` instead of
extending the base list — dropping `decorators`/`esnext.decorators` (needed by
`Symbol.metadata` in `entifix-ts-core`) or omitting `dom`. To see what the pass is
hiding:

```sh
pnpm nx build <lib> --skipTypeCheck=false
```

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
5. **Libraries compile per-file, never bundle.** Every `packages/*` library builds
   with `@nx/js:swc`; a `rollup.config.*`/`vite.config.ts` under `packages/` is a
   regression. Bundling drops `"use client"`, inlines CommonJS, and collides with
   the `.d.ts` that `tsc --build` writes to the same `dist`. See
   [How a library is built](#how-a-library-is-built).

## Module boundaries

The golden rule above is **enforced**, not just reviewed. Every project declares
`nx.tags` in its `package.json`, and `eslint.config.mjs` turns those tags into
`@nx/enforce-module-boundaries` constraints across six dimensions:

| Dimension    | Tags                                                                                     | Rule                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **layer**    | `layer:app` › `shell` › `implementation` › `business` › `entifix` › `utils`              | depend only on layers **below** (`shell`/`business`/`entifix` also allow ordered same-layer) |
| **scope**    | `scope:{marketplace, marketplace-admin, auth, transaction, config, shared}`              | a domain may depend only on itself or `scope:shared` (the reusable core)                     |
| **entifix**  | `entifix:core` ‹ `contract` ‹ {`tooling`, `style`} ‹ `transactions` ‹ `client` ‹ `react` | internal ordering inside the entifix layer                                                   |
| **business** | `business:policy` ‹ `business:domain`                                                    | a domain may use the shared authorization vocabulary, never another domain                   |
| **shell**    | `shell:base` ‹ `shell:domain`                                                            | a domain shell may mount onto the framework shell; base shells stay independent              |
| **host**     | `host:next`, `host:effect`, `runtime:datastore`                                          | a `host:next` app may **not** depend on a `runtime:datastore` package                        |
| **type**     | `type:testing`, `type:e2e`                                                               | spec files may import `type:testing` libs; source files may not                              |

The rule ANDs every constraint a project's tags match, so the dimensions compose.
Consequence: **to make an edge legal, retag the project — never relax the rule.**
Adding a new project without tags leaves it on the permissive `*` catch-all; give
it the right `layer:`/`scope:` (plus `entifix:` under `packages/entifix` or
`business:` under `packages/business`).
Verify with `pnpm nx run-many -t lint`.

**Why `business:*` exists.** `business-ts-authz` holds the authorization
vocabulary (`Permission`, `Role`, `can`) that `business-ts-authn` needs in order
to give `UserIdentity` a role. That is a same-layer edge, which the `layer:*`
dimension alone would either forbid outright or open up completely — so the
business layer got the same treatment `entifix:*` already gives the framework
layer: one ordered dimension, `policy` ‹ `domain`. A domain package reaches down
to policy; it still cannot import a sibling domain.

**Why `shell:*` exists.** Same story one layer up. `layer:shell` forbade
same-layer edges outright, so a per-domain API module could not reach
`requirePermission`/`makeServerLayer` in `shells-effect-service` — the module
pattern was unbuildable. `shell:base` ‹ `shell:domain` orders the layer the same
way, so a domain shell mounts onto the framework shell while base shells stay
independent of each other.

**Why `host:*` exists.** Apps sit at the top layer, so nothing stopped a Next app
from importing `makeMongoRepository` and writing a database directly — the one
hole in "one writer per database"
([ADR 0008](adr/0008-domain-modules-and-service-topology.md)). The datastore
clients carry `runtime:datastore`, Next apps carry `host:next`, and a
`notDependOnLibsWithTags` constraint makes that import a build failure. A Next
backend is composition — cookies, proxying, RSC aggregation — never data access.

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
   unless the flow is genuinely new. Give `@entity` a `labelKey`/`pluralKey` and
   every `@accessor` a `labelKey` (plus `enumLabelKey` when it is an enum), then
   add the matching subtree to the `entity` namespace in
   `packages/entifix/ts/i18n/src/resources/{es,en}/entity.ts`. Keys mirror the
   entity's own `key`, so they are derivable: `entity:product.fields.code`. See
   [I18N.md](I18N.md).
2. **Organism** — a React component in `implementation/<domain>/react` that runs
   the UC with `useDataLoading`.
3. **Page** — wire the adapter(s) and any link resolver in `shells/next/<shell>`
   (the page is the composition root).
4. **Backend route** — in the `-service`, provide `makeMongoRepository(db, Ctor)`
   for `EntityRepositoryTag` and serialize the result.
5. **Config** — if it introduces a new service/URL, add a seed row in
   `apps/config-service/src/db.ts`; never hardcode a URL or connection string.
6. **Check the catalogs** — `node tools/check-i18n.mjs`. A key present in `es`
   and missing in `en` will already have failed the build, but this also catches
   empty values and placeholder drift.

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
pnpm nx e2e back-office-app-e2e                       # mock
pnpm nx e2e marketplace-admin-service-e2e                   # mock

pnpm run back-office:dev                                    # then, in another shell:
E2E_PROFILE=live \
  MARKETPLACE_ADMIN_SERVICE_URL=http://localhost:3101 \
  MARKETPLACE_SERVICE_URL=http://localhost:3100 \
  pnpm nx e2e back-office-app-e2e
```

`mock` is the default because the default has to run anywhere. `live` never
falls back: a missing target URL **throws**, because a suite that skips itself
reports green for a run that tested nothing.

**A `mock` run refuses a development server.** Playwright's
`reuseExistingServer` attaches to whatever already listens on the app's port, so
a suite started while `back-office:dev` is up tested a `next dev` bundle against
the _real_ fleet while reporting on a hermetic run — and could fail, or pass, for
reasons unrelated to the code. Reuse stays (turning it off costs a production
build every time); the assumption is checked instead. `assertExpectedServer` runs
as `globalSetup`, reads `mode` from `/api/health/live`, and fails the run before
the first spec. `R10C_E2E_ALLOW_DEV_SERVER=1` opts out. `live` is exempt: it
expects an already-running app and makes no hermeticity claim.

**Both profiles run chromium**, and `E2E_BROWSERS=all` adds firefox and webkit
(after `pnpm exec playwright install`). Interception is `page.route()`, which
behaves identically everywhere, so the other engines re-assert the same wire
traffic; and insisting on three engines only made a `live` run fail on a browser
nobody had installed. Cross-browser rendering is worth checking deliberately.

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

**Signing a suite in.** Both Next apps are behind the auth middleware, so a spec
that navigates without a session gets a redirect instead of a page. Two things
follow, and a new gated e2e project needs both:

- **`seedSession(context, { roles })`** (`…/playwright`) puts a session on the
  browser context before the first navigation. In `mock` it fabricates the
  cookie — deliberately unsigned, since the only things exercised there are the
  middleware's presence check and the server-rendered nav filter, and the
  services are msw fixtures anyway. In `live` it performs a **real sign-in**
  through Zitadel's hosted v2 login, so the token is one auth-service minted and
  the downstream `requirePermission` checks are genuinely hit — which is why the
  fixture switches on v2's **routes** (`/loginname`, `/password`, `/mfa/set`,
  `/accounts`) rather than on `data-testid`s, v2 reusing those across screens.
  Wire it as an `auto` fixture
  (see `back-office-app-e2e/src/support/fixtures.ts`) so a new spec cannot
  forget it.
- **`readyPath`** on `defineEntifixE2eConfig`. Playwright polls a URL to decide
  the server is up, and that URL has to be outside the gate _and_ free of backend
  dependencies: probing `/` redirects to a sign-in that is not running, and
  probing `/api/config` 500s until config-service is. back-office-app
  exposes `/api/health` for exactly this and exempts it in the matcher.

A guarded **service** suite takes the same shape: `defineServiceE2e` accepts an
`authorization` hook so the journeys run as a principal instead of every spec
turning into an authentication test. The guard itself is asserted separately,
where omitting or corrupting the header is the point.

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
  touched projects). Pre-commit runs the `lint,build` subset; CI runs `lint`, then
  `build,typecheck` together, then `test` and `e2e`.
- Coverage: `pnpm nx run-many -t test --coverage` — every `packages/*` project
  must stay at 100%.
- Runtime: bring up `infra/local`, then `pnpm nx run <service>:dev` and exercise
  the routes (`/api/health`, `/api/config`, the entity routes). For frontends,
  drive the `/catalog/*` pages.

## Keeping the documentation true

Documentation drifts because nothing fails when it does. Two mechanisms make
parts of it fail, split by what a machine can actually know.

**Generated — `tools/sync-docs.mjs`.** Three tables are written from source and
must not be edited by hand:

| Block            | In                       | Source               |
| ---------------- | ------------------------ | -------------------- |
| `ports-infra`    | `docs/_shared/ports.md`  | `infra/local/lib.sh` |
| `store-register` | `docs/_shared/planes.md` | `tools/slices/`      |
| `adr-index`      | `docs/adr/README.md`     | the ADR files        |

Each sits between `<!-- docs:begin <name> -->` and `<!-- docs:end <name> -->`.
Change the source, run `node tools/sync-docs.mjs`, stage the result.

```sh
node tools/sync-docs.mjs           # rewrite the blocks
node tools/sync-docs.mjs --check   # fail if any is stale (pre-commit + CI)
```

Output is Prettier-formatted before it is written, because `lint-staged`
formats markdown on commit and a generator emitting its own table alignment
would be reformatted immediately — `--check` would then never pass again.

**Asserted — `@r10c/docs-check`.** Everything else stays hand-written prose, and
the checks assert that the identifiers inside it still exist:

```sh
pnpm nx test @r10c/docs-check
```

It holds relative links and heading anchors, the router tables in `CLAUDE.md`
and `README.md`, every entity name the business docs use, every tag dimension in
`nx.tags`, the fleet ports (`ALL_PORTS` ↔ the port table ↔ what each app binds),
and **ADR supersession symmetry** — a record claiming to supersede another must
leave the reciprocal `- Revised:` line on the record it overrode. Both jobs are
**unconditional** in CI for the same reason the i18n catalog check is: a
documentation claim is everyone's problem, not the affected projects'.

A third, **advisory** check (`tools/docs/staleness.mjs`) reports code that
changed without its documentation being touched, into the PR's job summary. It
never blocks — it can only see that a doc was not edited, not that it is wrong,
and a blocking version would teach everyone to make a trivial edit to whatever
file it names.

## Commits & PRs

- **Conventional Commits with Nx scopes** (`@commitlint/config-nx-scopes`) — the
  scope is the project name: `feat(entifix-ts-mongo-client): add filter translator`.
  Enforced by commitlint.
- `.husky/pre-commit` runs `lint-staged`, then `node tools/sync-docs.mjs --check`,
  then `pnpm nx affected -t lint,build --base=origin/main` (it `git fetch`es
  first, so origin must be reachable).
- `.husky/post-commit` runs `graphify update .` to keep the local knowledge graph
  in step. Pure AST, no API key, and it can never fail a commit. The semantic
  pass that re-reads documentation is LLM-backed and deliberately **not** here.
- Branch off `main`; keep changes within the layer boundaries.
- Do **not** add AI/tool co-author trailers or "generated with" lines to commits,
  PRs, or docs.
