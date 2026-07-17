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
   or `@effect/platform`. If a use-case needs something, it *yields a `Context.Tag`*;
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
- Runtime: bring up `infra/local`, then `pnpm nx run <service>:dev` and exercise
  the routes (`/api/health`, `/api/config`, the entity routes). For frontends,
  drive the `/catalog/*` pages.

## Commits & PRs

- **Conventional Commits with Nx scopes** — the scope is the project name:
  `feat(entifix-ts-mongo-client): add filter translator`. Enforced by commitlint.
- Branch off `main`; keep changes within the layer boundaries.
- Do **not** add AI/tool co-author trailers or "generated with" lines to commits,
  PRs, or docs.
