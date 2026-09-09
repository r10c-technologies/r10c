/**
 * The `mock` profile's backend for the storefront, installed **inside the Next
 * server process**.
 *
 * ⚠️ It has to be here rather than in the Playwright fixture, and that is the
 * whole reason this file exists. Every other suite in the repo stubs with
 * `page.route()` through `@msw/playwright`, which sees what the *browser*
 * requests. The storefront is React server components: its reads never leave
 * the Next process, so a browser-side interceptor sees nothing, every stub goes
 * unused and the page renders whatever a missing backend renders.
 *
 * So `next start` is launched with `--import ./src/support/server-mocks.mjs`,
 * and msw patches `fetch` here. **Order is the mechanism**: `--import` runs
 * before Next's entry, so Next's own cached-fetch wrapper wraps the patched
 * `fetch` rather than the other way round. Register after Next boots and the
 * interception is invisible.
 *
 * The handlers themselves are the ones the back-office suite already uses:
 * `makeEntityBackend` runs the *production* query pipeline
 * (`parseLoadRequestParams → loadUCFactory → makeMongoRepository → fake
 * driver`), so `mock` and `live` agree about filtering, sorting, paging and the
 * `400` the metadata allowlist produces. Nothing here re-implements RSQL.
 *
 * ⚠️ Everything below the `type:testing` layer has to come from a **`dist`**,
 * which is why `package.json` makes this project's `e2e` target depend on those
 * builds by name. Nothing else produces them: Next transpiles workspace source
 * itself, so the app's own build leaves no library `dist` behind, and
 * `@r10c/entifix-ts-testing-e2e` has no build target of its own — so `^build`
 * stops there and never reaches what its fixtures import. A runner that skips
 * them fails with `ERR_MODULE_NOT_FOUND` before the server starts.
 *
 * The list is the fixtures barrel's own imports, not a guess: it re-exports
 * `fake-infrastructure`, so importing anything from it loads the Mongo, Redis
 * **and** AMQP client layers, whether or not this preload uses them.
 *
 * ⚠️ It must also run with `--conditions=@r10c/source` **off**. `nx.json` sets that
 * on every `e2e` target, and under it a business package resolves to its
 * TypeScript source — where the first `@entity()` decorator is a
 * `SyntaxError`, because Node strips types and does not transform them. The
 * launch command clears `NODE_OPTIONS` for exactly this reason; the entity
 * classes below must come from their `dist`.
 *
 * Nothing in the application bundle knows this exists.
 */
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);

const [
  { ProductBrand, ProductCategory },
  { PublishedOffering },
  { configurationHandler, entityBackendHandlers, http, HttpResponse },
  { setupServer },
  { BRAND_SEED, CATEGORY_SEED, OFFERING_SEED },
] = await Promise.all([
  import('@r10c/business-ts-catalog-reference'),
  import('@r10c/business-ts-marketplace-catalog'),
  import('@r10c/entifix-ts-testing-e2e/fixtures'),
  import('msw/node'),
  import('./catalog-seed.mjs'),
]);

/** Where the storefront's server components look, and what they find. */
const CONFIG_URL = 'http://localhost:3190/api/config/marketplace-app';
const SERVICE_URL = 'http://localhost:3100/api';

/**
 * ⚠️ The `uri` group only. A server component reads config-service directly,
 * so there is no `rewriteServiceDomains` step and no proxy path to substitute —
 * what the app resolves here is the address it will actually dial.
 */
const CONFIGURATION = {
  uri: [{ key: 'marketplace-service-domain', value: SERVICE_URL }],
};

const collections = [
  entityBackendHandlers(PublishedOffering, {
    baseUrl: `${SERVICE_URL}/published-offering`,
    seed: OFFERING_SEED,
  }),
  entityBackendHandlers(ProductBrand, {
    baseUrl: `${SERVICE_URL}/product-brand`,
    seed: BRAND_SEED,
  }),
  entityBackendHandlers(ProductCategory, {
    baseUrl: `${SERVICE_URL}/product-category`,
    seed: CATEGORY_SEED,
  }),
];

/**
 * The checkout coordinator.
 *
 * ⚠️ **Not an entity backend**, and not a bare `201` either: the storefront's
 * confirmation page renders the order out of the saga's *own* answer, so a stub
 * that omitted the outcomes would exercise the degraded path while the spec
 * claimed to test a receipt. The shape here is transaction-service's, one
 * outcome per step, each carrying the participant's response body verbatim.
 *
 * It echoes the lines it was sent, so the receipt shows what the browser
 * actually put in the cart rather than a fixture that cannot disagree with it.
 */
const CHECKOUT_URL = 'http://localhost:3103/api/saga/checkout';

const checkoutHandler = http.post(CHECKOUT_URL, async ({ request }) => {
  const body = await request.json();
  const items = body?.inputs?.['write-order']?.[0]?.body?.data?.items ?? [];

  return HttpResponse.json(
    {
      meta: { type: 'sagaResult', entity: 'checkout' },
      data: {
        sagaId: 'e2e-saga',
        state: 'COMPLETED',
        outcomes: [
          {
            stepId: 'reserve',
            calls: items.map((_line, index) => ({
              index,
              status: 201,
              body: {},
            })),
          },
          {
            stepId: 'write-order',
            calls: [
              {
                index: 0,
                status: 201,
                body: {
                  meta: { type: 'entity', entity: 'product-order' },
                  data: {
                    id: 'e2e-order-1',
                    status: 'pending',
                    placedAt: '2026-09-09T00:00:00.000Z',
                    items,
                  },
                },
              },
            ],
          },
        ],
      },
    },
    { status: 201 },
  );
});

setupServer(
  configurationHandler(CONFIG_URL, CONFIGURATION),
  checkoutHandler,
  ...collections.flatMap(({ handlers }) => handlers),
).listen({
  // Next serves its own documents, RSC payloads and static assets over this
  // same `fetch`. Only the two service origins above are ours to answer.
  onUnhandledRequest: 'bypass',
});
