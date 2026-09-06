import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  configurationHandler,
  entityBackendHandlers,
  http,
  HttpResponse,
} from '@r10c/entifix-ts-testing-e2e/fixtures';
import {
  defineEntifixE2eTest,
  seedSession,
} from '@r10c/entifix-ts-testing-e2e/playwright';

import { brandSeed, categorySeed, productSeed } from './catalog-seed';

/** Where the admin app is served, and where its adapters look for the services. */
export const APP_URL = process.env['BASE_URL'] ?? 'http://localhost:3001';
export const SERVICE_URL = 'http://localhost:3101/api';
/**
 * The second catalog backend. ADR 0022 moved brand and category out of the
 * tenant plane into `catalog-reference`, which marketplace-service owns, so the
 * app composes their URLs from a different configuration key. Stubbing them on
 * `:3101` is what let the brand pages break in a real fleet while this suite
 * stayed green — the fixture was wrong in exactly the same way the app was.
 */
export const REFERENCE_SERVICE_URL = 'http://localhost:3100/api';

export const BRAND_URL = `${REFERENCE_SERVICE_URL}/product-brand`;
export const CATEGORY_URL = `${REFERENCE_SERVICE_URL}/product-category`;
export const PRODUCT_URL = `${SERVICE_URL}/product-specification`;

/**
 * The configuration values the REST adapters need in order to build their URLs.
 * In `live` the app resolves them from config-service instead.
 */
const CONFIGURATION = {
  uri: [
    { key: 'marketplace-admin-service-domain', value: SERVICE_URL },
    { key: 'marketplace-service-domain', value: REFERENCE_SERVICE_URL },
  ],
};

const { handlers, backend } = entityBackendHandlers(ProductBrand, {
  baseUrl: BRAND_URL,
  seed: brandSeed,
});

/**
 * The other two catalog entities, so a journey through the product form has both
 * relations to pick from. One backend per entity, because each serves the routes
 * of its own collection.
 */
const categories = entityBackendHandlers(ProductCategory, {
  baseUrl: CATEGORY_URL,
  seed: categorySeed,
});
const products = entityBackendHandlers(ProductSpecification, {
  baseUrl: PRODUCT_URL,
  seed: productSeed,
});

/** The mock catalog, for reseeding or for breaking on purpose. */
export const catalogBackend = backend;
export const categoryBackend = categories.backend;
export const productBackend = products.backend;

/**
 * What the tracker currently says about a transaction, and what the command
 * endpoint answers.
 *
 * ⚠️ These are hand-written rather than served by `entityBackendHandlers`,
 * because that backend is **read-only** — it exposes `list` and `get` and no
 * write at all, which is why no browser-side create has ever been exercised
 * (ADR 0028 records the create bug that fact hid). Widening the shared fixture
 * is a bigger change than this journey needs.
 */
export const transactionState: {
  record: Record<string, unknown> | undefined;
  status: number;
} = { record: undefined, status: 404 };

/** Points the tracker at a state, the way the real one would move. */
export function trackTransaction(
  state: 'PENDING' | 'COMPLETED' | 'FAILED',
  error?: string,
) {
  transactionState.status = 200;
  transactionState.record = {
    entity: 'product-specification',
    state,
    error,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
  };
}

/** Back to "the tracker has never heard of it" — the broker-down case. */
export function untrackTransactions() {
  transactionState.status = 404;
  transactionState.record = undefined;
}

const transactionHandlers = [
  // The command endpoint: a `202` describing a transaction, never an entity.
  http.post(PRODUCT_URL, async ({ request }) => {
    const body = (await request.json()) as {
      data: { transactionId: string };
    };
    return HttpResponse.json(
      {
        meta: { type: 'transactionEvent', entity: 'product-specification' },
        data: { transactionId: body.data.transactionId, state: 'PENDING' },
      },
      { status: 202 },
    );
  }),
  http.get(`${SERVICE_URL}/transaction/:id`, ({ params }) =>
    transactionState.status === 404
      ? HttpResponse.json(
          { error: 'transaction not found', code: 'notFound' },
          { status: 404 },
        )
      : HttpResponse.json({
          meta: { type: 'transactionEvent', entity: 'product-specification' },
          data: { ...transactionState.record, transactionId: params['id'] },
        }),
  ),
  // The stream itself is not stubbed: `EventSource` against an unstubbed path
  // simply never opens, which is exactly the "outcome missed" state the
  // reconcile-on-connect path exists for, and the one this journey drives.
];

/**
 * Two stubs, not one: the entity endpoint AND the app's `/api/config`. The
 * browser adapter resolves its base URL through the latter before it can issue
 * any entity request, so stubbing only the entity endpoint leaves the page
 * stuck and the spec passing vacuously.
 */
const base = defineEntifixE2eTest({
  handlers: [
    configurationHandler(`${APP_URL}/api/config`, CONFIGURATION),
    ...handlers,
    ...categories.handlers,
    ...products.handlers,
    ...transactionHandlers,
  ],
  // The app serves its own documents, RSC payloads and dev-tooling endpoints;
  // only unstubbed *service* traffic should fail a test.
  passthroughOrigins: [APP_URL],
});

/**
 * Every catalog journey runs signed in, because the app is now gated: its
 * middleware bounces a request with no access cookie, and the sidebar renders
 * only what the caller's roles grant. The session is seeded on the context
 * before the first navigation — an `auto` fixture rather than a per-spec call,
 * so a new spec cannot forget it and get a redirect instead of a page.
 *
 * `admin` because these journeys both read and write the catalog.
 */
export const test = base.extend<{ session: void }>({
  session: [
    async ({ context }, use) => {
      await seedSession(context, { roles: ['admin'] });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
