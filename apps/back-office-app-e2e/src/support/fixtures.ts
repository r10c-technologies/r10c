import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import {
  Reservation,
  StockItem,
  StockMovement,
} from '@r10c/business-ts-stock-management';
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
import { salesChannelSeed } from './sales-seed';
import {
  reservationSeed,
  stockItemSeed,
  stockMovementSeed,
} from './stock-seed';

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

/**
 * The third backend. Stock is tenant-plane and its own slice, so the app
 * composes its URLs from a third configuration key — stubbing it on `:3101`
 * would repeat the mistake the comment above records.
 */
export const STOCK_SERVICE_URL = 'http://localhost:3108/api';

/**
 * The fourth backend. Sales is tenant-plane and its own slice, so the app
 * composes its URLs from a fourth configuration key.
 */
export const SALES_SERVICE_URL = 'http://localhost:3109/api';

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
    { key: 'stock-service-domain', value: STOCK_SERVICE_URL },
    { key: 'sales-service-domain', value: SALES_SERVICE_URL },
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

const stockItems = entityBackendHandlers(StockItem, {
  baseUrl: `${STOCK_SERVICE_URL}/stock-item`,
  seed: stockItemSeed,
});
const stockMovements = entityBackendHandlers(StockMovement, {
  baseUrl: `${STOCK_SERVICE_URL}/stock-movement`,
  seed: stockMovementSeed,
});
const reservations = entityBackendHandlers(Reservation, {
  baseUrl: `${STOCK_SERVICE_URL}/reservation`,
  seed: reservationSeed,
});

const salesChannels = entityBackendHandlers(SalesChannel, {
  baseUrl: `${SALES_SERVICE_URL}/sales-channel`,
  seed: salesChannelSeed,
});

/**
 * The affordance documents the stock screens read, **captured verbatim from the
 * running service** rather than invented.
 *
 * They are the whole mechanism the stock surface depends on: `stock-item` and
 * `reservation` answer `["read"]` because no role holds a write for them and no
 * save route exists, so the generated form withholds Save and the screen is
 * read-only without a single client-side flag. `stock-movement` answers
 * `["read","write"]`, which is what makes recording a movement the one write in
 * the domain.
 *
 * ⚠️ They are served from the **app's own** `/api/stock/...` proxy path, not
 * from `STOCK_SERVICE_URL`: `stock-crud.tsx` builds its metadata source as an
 * app-relative URL so the browser never holds a backend address, and stubbing
 * the backend path instead would leave these unstubbed and every screen
 * pre-ADR-0026.
 */
const stockMetadataHandlers = (
  [
    ['stock-item', ['read']],
    ['stock-movement', ['read', 'write']],
    ['reservation', ['read']],
  ] as const
).map(([entity, actions]) =>
  http.get(`${APP_URL}/api/stock/${entity}/$metadata`, () =>
    HttpResponse.json({
      meta: { type: 'entityMetadata', entity },
      data: { actions, useCases: [] },
    }),
  ),
);

/**
 * The channel screens' affordance document, served from the **app's own**
 * `/api/sales/...` proxy path for the reason the stock ones are: the metadata
 * source is app-relative so the browser never holds a backend address, and
 * stubbing the backend path would leave these unstubbed and every screen
 * pre-ADR-0026.
 *
 * `["read","write","delete"]`, unlike stock's: a vendor authors their own
 * channels, so the generated form really does offer Save.
 */
const salesMetadataHandlers = [
  http.get(`${APP_URL}/api/sales/sales-channel/$metadata`, () =>
    HttpResponse.json({
      meta: { type: 'entityMetadata', entity: 'sales-channel' },
      data: { actions: ['read', 'write', 'delete'], useCases: [] },
    }),
  ),
];

/** The mock channel store, for reseeding or for breaking on purpose. */
export const salesChannelBackend = salesChannels.backend;

/** The mock stock store, for reseeding or for breaking on purpose. */
export const stockItemBackend = stockItems.backend;
export const stockMovementBackend = stockMovements.backend;

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
        meta: { type: 'transactionAccepted', entity: 'product-specification' },
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
          meta: { type: 'transactionRecord', entity: 'product-specification' },
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
    ...stockItems.handlers,
    ...stockMovements.handlers,
    ...reservations.handlers,
    ...salesChannels.handlers,
    ...stockMetadataHandlers,
    ...salesMetadataHandlers,
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
      // ⚠️ The entitlements matter as much as the roles, and only for the
      // stock section so far: its nav items are `entitled: true`, so ADR 0007's
      // second ceiling hides them from an organization not provisioned for the
      // domain — no error, no empty state, just no section. Mirrors what
      // auth-service seeds for the demo organization.
      await seedSession(context, {
        roles: ['admin'],
        entitlements: [
          'product-configuration-management',
          'stock-management',
          // Without it the Ventas sections are hidden from a vendor holding
          // every grant in the table — ADR 0007's second ceiling.
          'sales-management',
        ],
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
