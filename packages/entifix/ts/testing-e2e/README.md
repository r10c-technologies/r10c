# @r10c/entifix-ts-testing-e2e

The e2e layer: one set of journeys, two profiles. Test-only — private, no build
target, resolves straight to source through the `@r10c/source` condition. Depend
on it as a `devDependency`.

## `E2E_PROFILE`

| Profile          | What is real                           | Needs infrastructure | Where it runs      |
| ---------------- | -------------------------------------- | -------------------- | ------------------ |
| `mock` (default) | the app / the service under test       | no                   | every pull request |
| `live`           | everything, down to Mongo and RabbitMQ | yes                  | locally, on demand |

```sh
pnpm nx e2e marketplace-admin-app-e2e                       # mock, the default
E2E_PROFILE=live MARKETPLACE_ADMIN_SERVICE_URL=http://localhost:3101 \
  pnpm nx e2e marketplace-admin-app-e2e
```

`mock` is the default because the default has to run anywhere. `live` never
falls back: a missing target URL **throws**, because a suite that skips itself
reports green for a run that tested nothing.

## What `mock` is not

It is not a stub that answers every filter with all the rows. `makeEntityBackend`
is assembled from the **production query pipeline**:

```
parseLoadRequestParams  →  loadUCFactory  →  makeMongoRepository  →  fake mongo driver
  (core: RSQL + the         (business)        (mongo-client:          (testing-unit/drivers)
   filterable/sortable                         filter translation)
   allowlist)
```

So RSQL, sorting, paging and the `400 invalid query` the metadata allowlist
produces behave identically in both profiles — which is what lets one spec suite
serve both. A mock backend with its _own_ query semantics would disagree with
the service the first time an operator was added.

## Spec layout

Selection is by filename, enforced by the config presets (`testIgnore` for
Playwright, `exclude` for Vitest) — never by an in-spec `test.skip`, so a run
with the wrong environment fails loudly.

```
src/
  <journey>.spec.ts        profile-agnostic — runs in BOTH profiles
  <journey>.mock.spec.ts   mock-only: wire assertions, injected failures
  <journey>.live.spec.ts   live-only: real infra, seeded data
  support/                 per-project fixtures and seed
```

Put a journey in `*.spec.ts` unless it _cannot_ run in both. Wire-shape
assertions (the exact `rsql=` string) and injected transport failures are
mock-only by nature; assertions about real seeded data are live-only.

## Entry points

```ts
import { resolveE2eProfile, isMockProfile, requireLiveUrl } from '@r10c/entifix-ts-testing-e2e';
import { entityBackendHandlers, configurationHandler } from '@r10c/entifix-ts-testing-e2e/fixtures';
import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';
import { defineEntifixE2eConfig, defineEntifixE2eTest, EntityTablePage } from '@r10c/entifix-ts-testing-e2e/playwright';
```

`.` carries no Playwright, no msw and no vitest, so a consumer pulls only what
its transport needs.

### App e2e (Playwright)

```ts
// playwright.config.ts
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/marketplace-admin-app',
  port: 3001,
});

// src/support/fixtures.ts
const { handlers, backend } = entityBackendHandlers(ProductBrand, { baseUrl, seed });
export const test = defineEntifixE2eTest({ handlers: [...handlers, configurationHandler(...)] });
```

Playwright starts the app itself (`next start`), never `nx run <app>:start`: an
nx invocation in `webServer.command` is inferred by `@nx/playwright/plugin` as a
_continuous task dependency_ of `e2e`, and the run then waits forever on a
server that never completes. The build is expressed as a plain `dependsOn` on
the e2e target instead.

Interception is `@msw/playwright` over Playwright's `page.route()`. The
application is untouched: no worker script, no `NEXT_PUBLIC_*` switch, no
mocking code in the shipped bundle. Unhandled requests **error** rather than
escaping to the network.

Two stubs are always needed, not one: the entity endpoint _and_ the app's
`/api/config`, because the REST adapters resolve their base URL through the
latter before they can issue the former. `configurationHandler` exists so that
is not something each suite has to remember.

### Service e2e (Vitest)

```ts
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_ADMIN_SERVICE_URL',
  startMock: () => serveTestService({ name, port: 0, router, appLayer: MockAppLayer }),
});

it('lists the catalog', async () => {
  const response = await service.client.get('/api/product-brand');
});
```

In `mock`, `serveTestService` (from `@r10c/shells-effect-service`) boots the
service's **real router** through the **real `makeServerLayer`** on an ephemeral
port, with only the `appLayer` swapped for one built from the driver fakes. The
routes, the use-cases, the repository adapter and the query translation all
execute — what is absent is the infrastructure, not the service.

## Layering note

This package sits under `entifix`, so it must not import from `shells` or
`apps`. That is why `defineServiceE2e` takes a `startMock` callback instead of
booting the service itself: the e2e project — which may depend on both — is what
puts `serveTestService` and its service's `router` together.

## Relationship to `entifix-ts-testing-unit`

`testing-unit` owns doubles, port contract suites and msw handlers for **unit**
specs; this package owns **profiles, fixtures and drivers** for e2e. It depends
on `testing-unit` (the fake Mongo driver is the same one), never the reverse.
`testing-unit/http`'s `entityRestHandlers` stays the naive in-array fixture for
unit specs — the faithful pipeline-backed one lives here.
