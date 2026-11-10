import { describeEntityUseCases, problemOf } from '@entifix/core';
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
import type { Locator, Page } from '@playwright/test';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { Configuration } from '@r10c/business-ts-configuration';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { ProductOrder } from '@r10c/business-ts-order-management';
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
  ShippingOrder,
  ShippingOrderNotTransitionable,
} from '@r10c/business-ts-shipping-order-management';
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
/** Where the order screens' adapters reach order-service under `mock`. */
export const ORDER_SERVICE_URL = 'http://localhost:3105/api';

export const FULFILMENT_SERVICE_URL = 'http://localhost:3110/api';
/** config-service, which the system-management screens list and edit. */
export const CONFIG_SERVICE_URL = 'http://localhost:3190/api';

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
    { key: 'order-service-domain', value: ORDER_SERVICE_URL },
    { key: 'fulfilment-service-domain', value: FULFILMENT_SERVICE_URL },
    { key: 'config-service-domain', value: CONFIG_SERVICE_URL },
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

/** One paid vendor order: the one a cancel journey cancels. */
export const PAID_ORDER_ID = 'product-order-paid-1';

const productOrders = entityBackendHandlers(ProductOrder, {
  baseUrl: `${ORDER_SERVICE_URL}/product-order`,
  seed: [
    {
      id: PAID_ORDER_ID,
      buyerId: 'buyer-1',
      vendorId: 'e2e-organization',
      groupId: 'group-1',
      paymentMethod: 'card',
      status: 'paid',
      placedAt: '2026-11-03T10:00:00.000Z',
      items: [
        {
          offeringId: 'product-offering-1',
          quantity: 2,
          amount: 25,
          currency: 'GTQ',
        },
      ],
    },
  ],
});

/**
 * The order screens' affordance document, on the app's own `/api/order/...`
 * proxy path, with the verbs the entity declares — `cancel` among them.
 */
const orderMetadataHandlers = [
  http.get(`${APP_URL}/api/order/product-order/$metadata`, () =>
    HttpResponse.json({
      meta: { type: 'entityMetadata', entity: 'product-order' },
      data: {
        actions: ['read'],
        useCases: describeEntityUseCases(ProductOrder),
      },
    }),
  ),
];

/** The cancellation every mocked cancel starts, and a spec settles. */
export const CANCEL_FLOW_ID = 'cancel-flow-1';

/** Every cancel the order screen asked for in this run. */
export const cancels: string[] = [];

/**
 * The staff `cancel` verb, answered as order-service does since #487: `202`
 * with the cancellation to follow, whose outcome the push stream brings.
 */
const cancelHandlers = [
  http.post(`${ORDER_SERVICE_URL}/product-order/:id/cancel`, ({ params }) => {
    cancels.push(String(params['id']));
    return HttpResponse.json(
      {
        meta: { type: 'flowAccepted', entity: 'product-order' },
        data: {
          flowId: CANCEL_FLOW_ID,
          links: [
            { rel: 'status', href: `/api/realtime/flow/${CANCEL_FLOW_ID}` },
            { rel: 'stream', href: '/api/realtime/stream' },
          ],
        },
      },
      { status: 202 },
    );
  }),
];

/** A shipment awaiting dispatch — the one the dispatch journey hands over. */
export const AWAITING_SHIPMENT_ID = 'shipping-order-awaiting-1';
/** A shipment already on its way, which the worklist must not open on. */
export const DISPATCHED_SHIPMENT_ID = 'shipping-order-dispatched-1';

const shipment = (id: string, orderId: string, status: string) => ({
  id,
  orderId,
  groupId: 'group-1',
  flowId: 'checkout-flow-1',
  paymentMethod: 'cod',
  amountDue: 50,
  currency: 'GTQ',
  lines: [{ offeringId: 'product-offering-1', quantity: 2 }],
  status,
});

/** The shipments a seeded vendor holds, one awaiting and one dispatched. */
export const shipmentSeed = () => [
  shipment(AWAITING_SHIPMENT_ID, 'order-awaiting-1', 'awaiting-dispatch'),
  shipment(DISPATCHED_SHIPMENT_ID, 'order-dispatched-1', 'dispatched'),
];

const shippingOrders = entityBackendHandlers(ShippingOrder, {
  baseUrl: `${FULFILMENT_SERVICE_URL}/shipping-order`,
  seed: shipmentSeed(),
});

export const shippingOrderBackend = shippingOrders.backend;

/** Moves one stored shipment, as fulfilment-service's conditional write does. */
export const moveShipment = (id: string, status: string) =>
  shippingOrders.backend.seed(
    shippingOrders.backend
      .rows()
      .map(row => (row['id'] === id ? { ...row, status } : row)),
  );

/** The fulfilment screens' affordance document, on the app's own proxy path. */
const fulfilmentMetadataHandlers = [
  http.get(`${APP_URL}/api/fulfilment/shipping-order/$metadata`, () =>
    HttpResponse.json({
      meta: { type: 'entityMetadata', entity: 'shipping-order' },
      data: {
        actions: ['read'],
        useCases: describeEntityUseCases(ShippingOrder),
      },
    }),
  ),
];

/** The delivery flow every mocked dispatch starts, and a spec settles. */
export const DELIVERY_FLOW_ID = 'delivery-flow-1';

/** Every dispatch the worklist asked for in this run. */
export const dispatches: string[] = [];

/**
 * The vendor's verbs, answered as fulfilment-service does: `dispatch` moves
 * nothing and answers `202` with the delivery flow to follow (its pivot is the
 * flow's dispatch step), while a courier's report is a plain move answering the
 * record as it now stands.
 */
const shippingVerbHandlers = [
  http.post(
    `${FULFILMENT_SERVICE_URL}/shipping-order/:id/dispatch`,
    ({ params }) => {
      dispatches.push(String(params['id']));
      return HttpResponse.json(
        {
          meta: { type: 'flowAccepted', entity: 'shipping-order' },
          data: {
            flowId: DELIVERY_FLOW_ID,
            links: [
              { rel: 'status', href: `/api/realtime/flow/${DELIVERY_FLOW_ID}` },
              { rel: 'stream', href: '/api/realtime/stream' },
            ],
          },
        },
        { status: 202 },
      );
    },
  ),
  http.post(
    `${FULFILMENT_SERVICE_URL}/shipping-order/:id/record-delivery`,
    ({ params }) => {
      const id = String(params['id']);
      const standing = shippingOrders.backend
        .rows()
        .find(r => r['id'] === id)?.['status'];
      // The conditional write: delivery is recorded only on a dispatched parcel.
      if (standing !== 'dispatched') {
        return HttpResponse.json(
          problemOf(
            new ShippingOrderNotTransitionable({
              shippingOrderId: id,
              standing: String(standing),
              transition: 'record-delivery',
            }),
          ),
          {
            status: 409,
            headers: { 'content-type': 'application/problem+json' },
          },
        );
      }
      moveShipment(id, 'delivered');
      const row = shippingOrders.backend.rows().find(r => r['id'] === id);
      return HttpResponse.json({
        meta: { type: 'entity', entity: 'shipping-order' },
        data: row,
      });
    },
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

/** The checkout every mocked till sale starts, and a spec settles. */
export const TILL_FLOW_ID = 'till-flow-1';

/**
 * The till's write, the channel's derived `sell` verb, on the app's own
 * proxy path. It answers as sales-service does: `202` with the checkout to
 * follow, whose outcome the push stream brings (ADR 0073). Whether a sale
 * happens is the live journey's question; this one is which endpoint the
 * till reaches, what it sends, and that it waits on the flow.
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
      return HttpResponse.json(
        {
          meta: { type: 'flowAccepted', entity: 'counter-sale' },
          data: {
            flowId: TILL_FLOW_ID,
            links: [
              { rel: 'status', href: `/api/realtime/flow/${TILL_FLOW_ID}` },
              { rel: 'stream', href: '/api/realtime/stream' },
            ],
          },
        },
        { status: 202 },
      );
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
 * The brand screen's affordance document, on the app's own
 * `/api/marketplace/...` proxy path, with the verbs the entity declares —
 * `retire` and its inverse `restore`, over a selection.
 */
const brandMetadataHandlers = [
  http.get(`${APP_URL}/api/marketplace/product-brand/$metadata`, () =>
    HttpResponse.json({
      meta: { type: 'entityMetadata', entity: 'product-brand' },
      data: {
        actions: ['read', 'write'],
        useCases: describeEntityUseCases(ProductBrand),
      },
    }),
  ),
];

/** Every brand verb the list ran in this run, with the ids it ran over. */
export const brandVerbs: Array<{ verb: string; ids: string[] }> = [];

/**
 * `retire` and `restore` over a selection, answered as marketplace-service
 * does: each selected row moves, and the outcome is per row.
 */
const brandVerbHandlers = [
  http.post(`${BRAND_URL}/:verb`, async ({ params, request }) => {
    const verb = String(params['verb']);
    const { selection } = (await request.json()) as {
      selection: { mode: 'ids'; ids: string[] };
    };
    brandVerbs.push({ verb, ids: selection.ids });
    const status = verb === 'retire' ? 'retired' : 'active';
    backend.seed(
      backend
        .rows()
        .map(row =>
          selection.ids.includes(String(row['id'])) ? { ...row, status } : row,
        ),
    );
    return HttpResponse.json({
      meta: { type: 'bulkOutcome', entity: 'product-brand' },
      data: selection.ids.map(id => ({ id, ok: true })),
    });
  }),
];

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
/**
 * The push stream every signed-in page opens (ADR 0072), answered as an idle
 * stream: the opening frame and a long `retry:`, so a spec that is not about
 * push never sees a frame, and nothing reaches the edge, where nothing serves
 * `/api/realtime/*` under `mock`. A spec about push replaces it.
 */
export const STREAM_URL = `${APP_URL}/api/realtime/stream`;

export const idleStream = () =>
  new HttpResponse('retry: 60000\n: open\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });

/** Where a pending flow catches up from (ADR 0073); `404` means still pending. */
export const FLOW_STATUS_URL = `${APP_URL}/api/realtime/flow/:id`;

/** A few configuration rows, one of them secret, for the system screens. */
const configurations = entityBackendHandlers(Configuration, {
  baseUrl: `${CONFIG_SERVICE_URL}/configuration`,
  seed: [
    {
      id: 'configuration-1',
      service: 'stock-service',
      groupName: 'uri',
      key: 'stock-service-domain',
      value: 'http://localhost:3108/api',
      isSecret: false,
    },
    {
      id: 'configuration-2',
      service: 'transaction-service',
      groupName: 'participant',
      key: 'participant.stockToken',
      value: '',
      isSecret: true,
    },
    {
      id: 'configuration-3',
      service: 'payment-service',
      groupName: 'cod',
      key: 'cod.maxAmount',
      value: '150000',
      isSecret: false,
    },
  ],
});

/**
 * The signed-in user's sessions, as auth-service reports them through the
 * app's own `/api/auth/sessions` route — stubbed here, in the browser, so the
 * sessions screen renders without a server behind the route.
 */
const sessionHandlers = [
  http.get(`${APP_URL}/api/auth/sessions`, () =>
    HttpResponse.json({
      items: [
        {
          sessionId: 'e2e-session',
          createdAt: '2026-11-05T08:00:00.000Z',
          expiresAt: '2026-11-05T20:00:00.000Z',
          absoluteExpiresAt: '2026-11-12T08:00:00.000Z',
          current: true,
          device: {
            deviceId: 'device-1',
            browser: 'Chrome',
            os: 'macOS',
            type: 'desktop',
          },
        },
        {
          sessionId: 'session-2',
          createdAt: '2026-11-04T09:00:00.000Z',
          expiresAt: '2026-11-04T21:00:00.000Z',
          absoluteExpiresAt: '2026-11-11T09:00:00.000Z',
          current: false,
          device: null,
        },
      ],
    }),
  ),
];

const realtimeHandlers = [
  http.get(STREAM_URL, idleStream),
  http.get(FLOW_STATUS_URL, () =>
    HttpResponse.json(
      { type: 'about:blank', code: 'notFound', status: 404 },
      { status: 404, headers: { 'content-type': 'application/problem+json' } },
    ),
  ),
];

const base = defineEntifixE2eTest({
  handlers: [
    configurationHandler(`${APP_URL}/api/config`, CONFIGURATION),
    ...handlers,
    ...brandMetadataHandlers,
    ...brandVerbHandlers,
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
    ...productOrders.handlers,
    ...orderMetadataHandlers,
    ...cancelHandlers,
    ...shippingOrders.handlers,
    ...fulfilmentMetadataHandlers,
    ...shippingVerbHandlers,
    ...createHandlers,
    ...configurations.handlers,
    ...sessionHandlers,
    ...realtimeHandlers,
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
          // And for the dispatch worklist.
          'shipping-order-management',
        ],
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

/**
 * The record a list or picker shows for `text`, in whichever layout it is in.
 *
 * Since entifix 0.20.0 a table pivots to cards when its own container is
 * narrower than its columns need (entifix ADR 0027), so a wide list in the main
 * pane, and every picker in a dialog or a wizard step, may be cards at the
 * default viewport. Both layouts are rendered and CSS hides one, so a spec that
 * is not about the layout asks for the visible row or card holding the text.
 */
export const record = (scope: Page | Locator, text: string | RegExp) =>
  scope.locator(':is(tr, article):visible').filter({
    // The inner locator is matched inside each row or card, so it is built
    // from the page rather than chained under `scope`.
    has: ('goto' in scope ? scope : scope.page()).getByText(
      text,
      typeof text === 'string' ? { exact: true } : {},
    ),
  });
