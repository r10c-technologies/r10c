# Contributing

> **Status (2026-07)** — Conventions below reflect the current codebase. They are
> enforced where possible by ESLint (`@nx/enforce-module-boundaries`), commitlint,
> and the pre-commit hook; the rest are review expectations.

## Golden rules

1. **Dependencies point downward only.** `apps → shells → implementation → business → entifix → utils`.
   Never import upward (e.g. an `entifix` package importing from `business` or
   `shells`). The lint rule will fail the build; if you feel the need to break it,
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
  `@effect/platform` — mismatched peers break `pnpm install` (see the
  `backend-db-connectivity` note).

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

- **Conventional Commits with Nx scopes** — the scope is the project name:
  `feat(entifix-ts-mongo-client): add filter translator`. Enforced by commitlint.
- Branch off `main`; keep changes within the layer boundaries.
- Do **not** add AI/tool co-author trailers or "generated with" lines to commits,
  PRs, or docs.
