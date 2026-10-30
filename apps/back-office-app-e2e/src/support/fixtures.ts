import { describeEntityUseCases } from '@entifix/core';
import {
  configurationHandler,
  entityBackendHandlers,
  http,
  HttpResponse,
} from '@entifix/testing-e2e/fixtures';
import {
  defineEntifixE2eTest,
  seedSession,
} from '@entifix/testing-e2e/playwright';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import {
  ProductOffering,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import {
  Agreement,
  CommissionEntry,
  SettlementRun,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import {
  Reservation,
  StockItem,
  StockMovement,
} from '@r10c/business-ts-stock-management';

import { brandSeed, categorySeed, productSeed } from './catalog-seed';
import { publishedOfferingSeed, salesChannelSeed } from './sales-seed';
import {
  agreementSeed,
  commissionEntrySeed,
  settlementRunSeed,
  vendorPayoutSeed,
} from './settlement-seed';
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

/**
 * The fifth backend. Settlement is **control** plane rather than tenant, so the
 * app composes its URLs from a fifth configuration key for a different reason
 * than the two above: there is no tenancy in the path at all, and what narrows a
 * read is a predicate built from the session the proxy carries upstream.
 */
export const SETTLEMENT_SERVICE_URL = 'http://localhost:3107/api';

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
    { key: 'settlement-service-domain', value: SETTLEMENT_SERVICE_URL },
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

const agreements = entityBackendHandlers(Agreement, {
  baseUrl: `${SETTLEMENT_SERVICE_URL}/agreement`,
  seed: agreementSeed,
});

const commissionEntries = entityBackendHandlers(CommissionEntry, {
  baseUrl: `${SETTLEMENT_SERVICE_URL}/commission-entry`,
  seed: commissionEntrySeed,
});

const settlementRuns = entityBackendHandlers(SettlementRun, {
  baseUrl: `${SETTLEMENT_SERVICE_URL}/settlement-run`,
  seed: settlementRunSeed,
});

const vendorPayouts = entityBackendHandlers(VendorPayout, {
  baseUrl: `${SETTLEMENT_SERVICE_URL}/vendor-payout`,
  seed: vendorPayoutSeed,
});

/**
 * The settlement screens' affordance documents, served from the **app's own**
 * `/api/settlement/...` proxy path for the reason the stock ones are.
 *
 * ⚠️ **`agreement` answers `["read"]`, not `["read","write"]`**, and that is the
 * assertion rather than a conservative fixture. No role holds
 * `settlement-management:agreement:write` — an `admin` who could write it could
 * set their own commission to zero — so the form an `admin` opens offers no
 * Save, with no client-side flag anywhere. The other three are read-only because
 * a fold produces them and nobody authors them.
 */
const settlementMetadataHandlers = (
  [
    ['agreement', ['read']],
    ['commission-entry', ['read']],
    ['settlement-run', ['read']],
    ['vendor-payout', ['read']],
  ] as const
).map(([entity, actions]) =>
  http.get(`${APP_URL}/api/settlement/${entity}/$metadata`, () =>
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

const publishedOfferings = entityBackendHandlers(PublishedOffering, {
  baseUrl: `${REFERENCE_SERVICE_URL}/published-offering`,
  seed: publishedOfferingSeed,
});

/** Every sale the till rang up in this run, as the proxy received it. */
export const ringUps: Array<{
  readonly url: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
}> = [];

/**
 * The till's write, the channel's derived `sell` verb, on the app's own
 * proxy path. It answers as sales-service does once the checkout completed;
 * whether a sale happens is the live journey's question, and this one is
 * which endpoint the till reaches and what it sends.
 */
const sellHandlers = [
  http.post(
    `${APP_URL}/api/sales/sales-channel/:id/sell`,
    async ({ request }) => {
      ringUps.push({
        url: new URL(request.url).pathname,
        idempotencyKey: request.headers.get('idempotency-key'),
        body: await request.json(),
      });
      return HttpResponse.json({
        meta: { type: 'sagaResult', entity: 'counter-sale' },
        data: {},
      });
    },
  ),
];

/**
 * Two draft offerings, one priced and one not: the pair a bulk publish needs
 * to show it reports each row on its own.
 */
const offerings = entityBackendHandlers(ProductOffering, {
  baseUrl: `${SERVICE_URL}/product-offering`,
  seed: [
    {
      id: 'offering-priced',
      name: 'Taza esmaltada',
      specificationId: 'product-1',
      status: 'draft',
    },
    {
      id: 'offering-unpriced',
      name: 'Plato hondo',
      specificationId: 'product-1',
      status: 'draft',
    },
  ],
});

/**
 * The offering screen's affordance document, with the verbs the entity really
 * declares — `publish` and `unpublish`, on a record and over a selection — so
 * the bulk bar renders what the service would offer.
 */
const offeringMetadataHandlers = [
  http.get(`${APP_URL}/api/admin/product-offering/$metadata`, () =>
    HttpResponse.json({
      meta: { type: 'entityMetadata', entity: 'product-offering' },
      data: {
        actions: ['read', 'write', 'delete'],
        useCases: describeEntityUseCases(ProductOffering),
      },
    }),
  ),
];

/**
 * A bulk publish, answered as the service does: per row, the unpriced
 * offering refused with the code the toast translates.
 */
const bulkPublishHandlers = [
  http.post(`${SERVICE_URL}/product-offering/publish`, () =>
    HttpResponse.json({
      meta: { type: 'bulkOutcome', entity: 'product-offering' },
      data: [
        { id: 'offering-priced', ok: true },
        { id: 'offering-unpriced', ok: false, code: 'offeringHasNoPrice' },
      ],
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
 * A specification's create, answered as the service does: the record as
 * stored, under the code it drew.
 *
 * ⚠️ Hand-written rather than served by `entityBackendHandlers`, because that
 * backend is **read-only** — it exposes `list` and `get` and no write at all.
 */
const createHandlers = [
  http.post(PRODUCT_URL, async ({ request }) => {
    const body = (await request.json()) as {
      data: Record<string, unknown>;
    };
    return HttpResponse.json({
      meta: { type: 'entity', entity: 'product-specification' },
      data: { ...body.data, id: 'spec-created', code: 'product-901' },
    });
  }),
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
    ...agreements.handlers,
    ...commissionEntries.handlers,
    ...settlementRuns.handlers,
    ...vendorPayouts.handlers,
    ...settlementMetadataHandlers,
    ...stockMetadataHandlers,
    ...salesMetadataHandlers,
    ...publishedOfferings.handlers,
    ...offerings.handlers,
    ...offeringMetadataHandlers,
    ...bulkPublishHandlers,
    ...sellHandlers,
    ...createHandlers,
  ],
  // The app serves its own documents, RSC payloads and dev-tooling endpoints;
  // only unstubbed *service* traffic should fail a test.
  passthroughOrigins: [APP_URL],
});

/**
 * Every catalog journey runs signed in, because the app is now gated: its
 * proxy bounces a request with no access cookie, and the sidebar renders
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
          // And the same for the settlement sections, in both tiers.
          'settlement-management',
        ],
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
