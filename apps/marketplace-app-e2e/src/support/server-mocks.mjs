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
 * `@entifix/testing-e2e` has no build target of its own — so `^build`
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

/**
 * The shared catalog fixtures (`@r10c/testing-catalog-fixtures`), read as the
 * JSON they are rather than through the package's TypeScript entry: this file
 * runs in plain Node, before anything could transpile it. Storybook and the
 * fixtures' own spec read the same files, and that spec is what validates them.
 */
const fixture = name =>
  import(`@r10c/testing-catalog-fixtures/data/${name}.json`, {
    with: { type: 'json' },
  }).then(module => module.default);

const [
  { ProductBrand, ProductCategory },
  { PublishedOffering },
  { PublishedVendor },
  { configurationHandler, entityBackendHandlers, http, HttpResponse },
  { setupServer },
  offerings,
  brands,
  categories,
  vendors,
] = await Promise.all([
  import('@r10c/business-ts-catalog-reference'),
  import('@r10c/business-ts-marketplace-catalog'),
  import('@r10c/business-ts-marketplace-vendor'),
  import('@entifix/testing-e2e/fixtures'),
  import('msw/node'),
  fixture('offerings'),
  fixture('brands'),
  fixture('categories'),
  fixture('vendors'),
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
    seed: offerings,
  }),
  entityBackendHandlers(ProductBrand, {
    baseUrl: `${SERVICE_URL}/product-brand`,
    seed: brands,
  }),
  entityBackendHandlers(ProductCategory, {
    baseUrl: `${SERVICE_URL}/product-category`,
    seed: categories,
  }),
  entityBackendHandlers(PublishedVendor, {
    baseUrl: `${SERVICE_URL}/published-vendor`,
    seed: vendors,
  }),
];

/**
 * The checkout coordinator, as the composed checkout answers it (ADR 0073):
 * `202` and a `flowAccepted` envelope naming the flow, never the outcome. The
 * outcome is the stream's, which the browser-side fixture scripts.
 *
 * ⚠️ **Each start mints its own flow id**, because this process serves every
 * worker at once: two specs sharing an id would read each other's basket back.
 * The id's prefix is how the rest of this file knows which journey it is in —
 * what is in the basket is the only thing a server action lets through.
 */
const CHECKOUT_URL = 'http://localhost:3103/api/flow/checkout';

/** Where the settle action verifies a flow completed, server to server. */
const FLOW_STATUS_URL = 'http://localhost:3191/api/realtime/flow/:id';

/**
 * Where the settle action reads the group back by its cancel nonce (ADR 0053),
 * matching `orderServiceUrl()`'s dev default.
 */
const BUYER_RECEIPT_URL =
  'http://localhost:3105/api/checkout-group/:id/buyer-receipt';

/**
 * Where the buyer's own cancel is presented. Stubbed here rather than with
 * `page.route()` for the same reason the coordinator is: the cancel is a server
 * action, so an interceptor in the browser would never see the call.
 */
const BUYER_CANCEL_URL =
  'http://localhost:3105/api/product-order/:id/buyer-cancellation';

/**
 * The cancel window the real service stamps at placement.
 *
 * ⚠️ **A long one on purpose.** The storefront renders the Cancel button only
 * while the window is open, so a fixture in the past would make the affordance
 * invisible and the spec below would pass while asserting the opposite of what
 * it claims. Far future, so the run's own clock cannot close it.
 */
const CANCEL_WINDOW_ENDS_AT = '2099-01-01T00:30:00.000Z';

/**
 * The basket whose cancel arrives before its payment was confirmed (#387): an
 * order turns `paid` only once `payment.captured` is consumed off the bus, and
 * until then order-service answers a buyer's cancel with `409 paymentPending`.
 */
const PAYMENT_PENDING_OFFERING = 'offering-terra-ceramic-mug';

/** The basket whose flow ends badly: flow-status says `failed` for it. */
const FAILING_OFFERING = 'offering-aurora-floor-lamp';

/** What each started flow was asked to check out, by flow id. */
const baskets = new Map();
let started = 0;

/**
 * A refusal as the fleet answers one: an `application/problem+json` body whose
 * `code` is the `errors` catalog key (ADR 0064).
 */
const problem = (tag, code, category, status, fields = {}) =>
  HttpResponse.json(
    {
      type: `urn:entifix:failure:${code}`,
      title: tag,
      status,
      code,
      category,
      ...fields,
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

const notFound = () => problem('NotFound', 'notFound', 'notFound', 404);

const holds = (vendors, offeringId) =>
  vendors.some(part =>
    (part?.lines ?? []).some(line => line?.offeringId === offeringId),
  );

const checkoutHandler = http.post(CHECKOUT_URL, async ({ request }) => {
  const body = await request.json().catch(() => undefined);
  const vendors = body?.vendors;
  if (!Array.isArray(vendors) || vendors.length === 0) {
    return problem('InvalidBody', 'invalidBody', 'invalid', 400);
  }
  started += 1;
  const kind = holds(vendors, FAILING_OFFERING)
    ? 'failing'
    : holds(vendors, PAYMENT_PENDING_OFFERING)
      ? 'payment-pending'
      : 'placed';
  const flowId = `e2e-flow-${kind}-${String(started)}`;
  baskets.set(flowId, vendors);
  return HttpResponse.json(
    {
      meta: { type: 'flowAccepted' },
      data: {
        flowId,
        links: [
          { rel: 'status', href: `/api/realtime/flow/${flowId}` },
          { rel: 'stream', href: '/api/realtime/stream' },
        ],
      },
    },
    { status: 202 },
  );
});

/**
 * Where a flow stands, as realtime-service answers it. It checks the
 * capability is *present* and nothing more — the digest comparison is the
 * service's own decision — and `404` is a flow it never started.
 */
/** Every cancellation a buyer started, by its flow id. */
const cancellations = new Set();

const flowStatusHandler = http.get(FLOW_STATUS_URL, ({ request, params }) => {
  const capability = new URL(request.url).searchParams.get('capability');
  if (!capability || !(baskets.has(params.id) || cancellations.has(params.id)))
    return notFound();
  return HttpResponse.json({
    meta: { type: 'flowStatus', entity: 'flow' },
    data: {
      flowId: params.id,
      state: params.id.startsWith('e2e-flow-failing-') ? 'failed' : 'completed',
    },
  });
});

/** The vendor order a flow wrote for one seller's part of its basket. */
const orderIdOf = (flowId, vendorId) =>
  flowId.startsWith('e2e-flow-payment-pending-')
    ? `${flowId}-${vendorId}-payment-pending`
    : `${flowId}-${vendorId}`;

/**
 * The group read back by its capability: one envelope for the group and one
 * per vendor order, each echoing the lines the checkout was sent, so the
 * receipt shows what the browser put in the cart rather than a fixture that
 * cannot disagree with it. No nonce, or a flow never started, is a `404`.
 */
const buyerReceiptHandler = http.get(
  BUYER_RECEIPT_URL,
  ({ request, params }) => {
    const vendors = baskets.get(params.id);
    if (!request.headers.get('x-cancel-nonce') || vendors === undefined) {
      return notFound();
    }
    return HttpResponse.json({
      group: {
        meta: { type: 'entity', entity: 'checkout-group' },
        data: {
          id: params.id,
          placedAt: '2026-11-03T00:00:00.000Z',
          // ⚠️ Server-stamped, and only for a group that brought a digest. It
          // is what turns the nonce the action minted into a capability the
          // receipt may offer.
          cancelWindowEndsAt: CANCEL_WINDOW_ENDS_AT,
          orderIds: vendors.map(part => orderIdOf(params.id, part.vendorId)),
        },
      },
      orders: vendors.map(part => ({
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          id: orderIdOf(params.id, part.vendorId),
          groupId: params.id,
          vendorId: part.vendorId,
          paymentMethod: part.paymentMethod,
          status: 'paid',
          items: part.lines,
        },
      })),
    });
  },
);

/**
 * A buyer cancelling one of their vendor orders.
 *
 * It checks the nonce is *present* and nothing more: what the digest comparison
 * protects is the service's own decision, and asserting it here would be
 * asserting a fixture. What this suite is for is the half only a browser can
 * show — that the button appears exactly when the receipt says it may, and that
 * the page afterwards says the order was cancelled.
 */
const buyerCancelHandler = http.post(
  BUYER_CANCEL_URL,
  async ({ request, params }) => {
    const body = await request.json().catch(() => undefined);
    if (typeof body?.cancelNonce !== 'string' || body.cancelNonce === '') {
      return problem(
        'CancelNotAuthorized',
        'cancelNotAuthorized',
        'unauthenticated',
        401,
      );
    }
    if (params.id.endsWith('-payment-pending')) {
      return problem('PaymentPending', 'paymentPending', 'conflict', 409, {
        orderId: params.id,
      });
    }
    // A cancellation is a flow (ADR 0066): started, answered `202`, and
    // followed by the receipt to its end on the stream.
    const flowId = `e2e-cancel-${params.id}`;
    cancellations.add(flowId);
    return HttpResponse.json(
      {
        meta: { type: 'flowAccepted', entity: 'product-order' },
        data: {
          flowId,
          links: [
            { rel: 'status', href: `/api/realtime/flow/${flowId}` },
            { rel: 'stream', href: '/api/realtime/stream' },
          ],
        },
      },
      { status: 202 },
    );
  },
);

/**
 * A search for this term reaches a backend that is down, so a spec can show
 * what a failed catalog read renders (#533) without stopping a process every
 * other worker is reading from. Matched on the raw query, whichever parameter
 * the adapters put the name filter in.
 */
const UNAVAILABLE_TERM = 'e2e-backend-down';

const unavailableHandler = http.get(
  `${SERVICE_URL}/published-offering`,
  ({ request }) =>
    decodeURIComponent(new URL(request.url).search).includes(UNAVAILABLE_TERM)
      ? new HttpResponse(null, { status: 503 })
      : undefined,
);

setupServer(
  unavailableHandler,
  buyerCancelHandler,
  buyerReceiptHandler,
  configurationHandler(CONFIG_URL, CONFIGURATION),
  checkoutHandler,
  flowStatusHandler,
  ...collections.flatMap(({ handlers }) => handlers),
).listen({
  // Next serves its own documents, RSC payloads and static assets over this
  // same `fetch`. Only the service origins above are ours to answer.
  onUnhandledRequest: 'bypass',
});
