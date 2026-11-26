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
import { createHash } from 'node:crypto';
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);

/**
 * The fleet's locales, declared before any handler parses a query: a
 * category's name is localized (#573), and the storefront sorts it as
 * `name.<locale>`, which entifix refuses for a locale this process never
 * declared. marketplace-service declares them the same way.
 */
await import('@r10c/business-ts-i18n/locales');

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
  { DeviceModel, ProductBrand, ProductCategory },
  { PublishedOffering, searchTextOf },
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

/** The vendor fixture, under a name the checkout's own `vendors` cannot shadow. */
const SELLERS = vendors;

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

/**
 * Offerings only these journeys need, kept out of the shared fixtures so no
 * Storybook story or count elsewhere moves (#567):
 *
 * - **One product, two sellers.** Two vendors offer "Lino Napkin Set" under
 *   the same name, and only the seller line tells their cards apart.
 * - **A seller whose name cannot be read.** `SELLER_DOWN_VENDOR` answers 503
 *   below, so a grid naming it shows every card without a seller line. Its
 *   one offering's picture is on a host the image optimizer may not fetch.
 *
 * - **A cable sold by the metre.** Its quantities are in the metre's scale,
 *   so 3.5 m is `3500` everywhere it is held.
 *
 * All of them are old, uncategorized and out of stock, so no home strip or
 * category count picks them up; the whole catalog's count does (40).
 */
const SELLER_DOWN_VENDOR = 'e2e-vendor-down';
/** A media host not on `STOREFRONT_IMAGE_HOSTS`; the browser is told it does not resolve. */
const OUTSIDE_MEDIA_HOST = 'https://media.example.org';

const journeyOffering = (offeringId, vendorId, name, amount) => ({
  id: offeringId,
  offeringId,
  vendorId,
  name,
  amount,
  currency: 'GTQ',
  // One piece at a time, priced for one (ADR 0082): the key a price sorts on.
  pricePer: 1,
  amountPerThousand: amount * 1000,
  saleUnit: 'UN',
  quantityStep: 1,
  quantityMinimum: 1,
  availableHint: false,
  publishedAt: '2025-01-01T00:00:00.000Z',
  code: offeringId.toUpperCase(),
});

/**
 * The phones "Mi teléfono" offers (plan 1.17), journey-only like the offerings
 * below. One retired, which the storefront must not offer.
 */
const DEVICE_MODELS = [
  { id: 'device-model-a15', name: 'Samsung Galaxy A15', status: 'active' },
  { id: 'device-model-ip15', name: 'iPhone 15', status: 'active' },
  { id: 'device-model-old', name: 'Nokia 3310', status: 'retired' },
];

/**
 * The two napkin sets double as the phone journey's answer, so no count
 * anywhere moves: one is made for the Galaxy A15 and one fits every phone, and
 * every other offering never said which phones it fits — so choosing the A15
 * leaves exactly these two.
 */
const JOURNEY_OFFERINGS = [
  {
    ...journeyOffering(
      'offering-lino-napkins-demo',
      'demo-organization',
      'Lino Napkin Set',
      4500,
    ),
    fitsDeviceModelIds: ['device-model-a15'],
  },
  {
    ...journeyOffering(
      'offering-lino-napkins-solano',
      'vendor-casa-solano',
      'Lino Napkin Set',
      4200,
    ),
    fitsDeviceModelIds: ['universal'],
  },
  {
    ...journeyOffering(
      'offering-eclipse-runner',
      SELLER_DOWN_VENDOR,
      'Eclipse Table Runner',
      9900,
    ),
    // On a host the optimizer is not allowed to fetch from, so its picture
    // renders as it is, with no `srcset` (#571).
    media: [{ url: `${OUTSIDE_MEDIA_HOST}/runner.jpg`, alt: 'Runner, folded' }],
  },
  // Sold by the half metre from one metre, at Q45.00 the metre (ADR 0082):
  // the storefront's quantity journeys in a unit that is not a piece. Q40.00
  // the metre from 10 m, for the whole line (§8).
  {
    ...journeyOffering(
      'offering-coax-cable',
      'demo-organization',
      'Coax Cable',
      4500,
    ),
    saleUnit: 'M',
    quantityStep: 500,
    quantityMinimum: 1000,
    tiers: [{ from: 10_000, amount: 4000 }],
  },
];

const collections = [
  entityBackendHandlers(PublishedOffering, {
    baseUrl: `${SERVICE_URL}/published-offering`,
    // The search text is derived at projection (#774), so a fixture row gets
    // it the way the projector would write it.
    seed: [...offerings, ...JOURNEY_OFFERINGS].map(row => ({
      ...row,
      searchText: searchTextOf(row),
    })),
  }),
  entityBackendHandlers(ProductBrand, {
    baseUrl: `${SERVICE_URL}/product-brand`,
    seed: brands,
  }),
  entityBackendHandlers(DeviceModel, {
    baseUrl: `${SERVICE_URL}/device-model`,
    seed: DEVICE_MODELS,
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
 * How long the receipt can be read back: days past the cancel window
 * (ADR 0076 §6). The storefront sizes the receipt cookie from it.
 */
const RECEIPT_ENDS_AT = '2099-01-31T00:00:00.000Z';

/**
 * The basket whose receipt is read after its cancel window closed (#579): the
 * group is stamped with a window already past and a receipt still open, so the
 * receipt renders and offers no Cancel.
 */
const CANCEL_CLOSED_OFFERING = 'offering-terra-dinner-plate';
const CANCEL_CLOSED_AT = '2026-01-01T00:30:00.000Z';

/**
 * The basket whose cancel arrives before its payment was confirmed (#387): an
 * order turns `paid` only once `payment.captured` is consumed off the bus, and
 * until then order-service answers a buyer's cancel with `409 paymentPending`.
 */
const PAYMENT_PENDING_OFFERING = 'offering-terra-ceramic-mug';

/**
 * The basket whose receipt cannot be read back after it settled: the settle
 * action's one read answers, and every render after it reaches an
 * order-service that is down, so the page says it could not load the order
 * (ADR 0051) rather than render a receipt with nothing in it.
 */
const RECEIPT_DOWN_OFFERING = 'offering-lino-napkins-solano';

/** How many times each flow's group was read back. */
const receiptReads = new Map();

/**
 * The receipt states the accessibility gate reads (#690), each from a basket
 * nothing else checks out: a payment-link order still waiting for its payment
 * (ADR 0081), and an order already on its way with its guide and its FEL
 * document (#668, #669).
 */
const AWAITING_LINK_OFFERING = 'offering-eclipse-runner';
const IN_TRANSIT_OFFERING = 'offering-coax-cable';

/** What a receipt's order adds in each of those states. */
const receiptStateOf = flowId =>
  flowId.startsWith('e2e-flow-awaiting-link-')
    ? {
        status: 'awaiting-payment',
        paymentMethod: 'link',
        paymentLinkUrl: 'https://pagos.example.com/p/e2e',
        paymentLinkProviderName: 'Banco de ejemplo',
        paymentLinkProviderKey: 'bank-link',
        paymentDueAt: '2099-01-02T00:00:00.000Z',
        paymentEvidence: [],
      }
    : flowId.startsWith('e2e-flow-in-transit-')
      ? {
          status: 'dispatched',
          courierName: 'Courier nacional',
          trackingNumber: 'GT-000123',
          trackingUrl: 'https://courier.example.com/track/GT-000123',
          fiscalDocumentType: 'FACT',
          fiscalSeries: 'E2E0001',
          fiscalNumber: '123456789',
          fiscalAuthorization: '00000000-0000-0000-0000-000000000123',
        }
      : undefined;

/** The basket whose flow ends badly: flow-status says `failed` for it. */
const FAILING_OFFERING = 'offering-aurora-floor-lamp';

/** What each started flow was asked to check out, by flow id. */
const baskets = new Map();

/**
 * Each started flow's buyer contact, by flow id, stored the way order-service
 * keeps it: one flat row, the phone normalized (ADR 0076 §1).
 */
const contacts = new Map();

const contactRowOf = contact => ({
  name: contact.name,
  phone: `+502${String(contact.phone).replace(/\D/g, '').slice(-8)}`,
  email: contact.email,
  ...contact.destination,
});

/**
 * A readable number for each flow, `7KQ4-0001`, and one for each seller's
 * order in it, as order-service draws them (ADR 0076 §5).
 */
const numberOf = flowId =>
  `7KQ4-${(flowId.split('-').at(-1) ?? '0').padStart(4, '0')}`;
const orderNumberOf = (flowId, index) =>
  `Q${String(index)}AW-${(flowId.split('-').at(-1) ?? '0').padStart(4, '0')}`;
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
  // A storefront start names its buyer's contact, as the coordinator's
  // `CheckoutStart` requires (ADR 0076 §3), nested and already checked.
  if (
    typeof body?.contact?.name !== 'string' ||
    typeof body?.contact?.destination?.municipio !== 'string' ||
    typeof body?.locale !== 'string'
  ) {
    return problem('Invalid', 'invalid', 'invalid', 400);
  }
  // A storefront sale is shipped, so a seller who does not ship refuses the
  // whole basket, as the coordinator does from the entitlements it verified
  // (ADR 0076 §3). The fixture's `acceptsCod` stands for that entitlement.
  const stranded = vendors.find(
    part =>
      SELLERS.find(vendor => vendor.vendorId === part?.vendorId)?.acceptsCod ===
      false,
  );
  if (stranded !== undefined) {
    return problem('VendorDoesNotShip', 'vendorDoesNotShip', 'declined', 422, {
      vendorId: stranded.vendorId,
    });
  }
  started += 1;
  const kind = holds(vendors, FAILING_OFFERING)
    ? 'failing'
    : holds(vendors, PAYMENT_PENDING_OFFERING)
      ? 'payment-pending'
      : holds(vendors, CANCEL_CLOSED_OFFERING)
        ? 'cancel-closed'
        : holds(vendors, RECEIPT_DOWN_OFFERING)
          ? 'receipt-down'
          : holds(vendors, AWAITING_LINK_OFFERING)
            ? 'awaiting-link'
            : holds(vendors, IN_TRANSIT_OFFERING)
              ? 'in-transit'
              : 'placed';
  const flowId = `e2e-flow-${kind}-${String(started)}`;
  baskets.set(flowId, vendors);
  contacts.set(flowId, contactRowOf(body.contact));
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

/** The IVA a 12 % IVA-inclusive gross carries, rounded once per document. */
const ivaIncludedIn = lines => {
  // Each line's total as the storefront previewed it, which this mock states
  // as the coordinator would: `lineTotal`, never a price times a quantity.
  const gross = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return gross - Math.round((gross * 10000) / 11200);
};

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
    const nonce = request.headers.get('x-cancel-nonce');
    if (!nonce || vendors === undefined) {
      return notFound();
    }
    // A group an access link re-keyed answers only the nonce it was re-keyed
    // to: the browser that held the old one is refused, as order-service
    // refuses it (ADR 0076 §6).
    const rekeyed = rekeyedTo.get(params.id);
    if (rekeyed !== undefined && rekeyed !== digestOf(nonce)) {
      return problem(
        'CancelNotAuthorized',
        'cancelNotAuthorized',
        'unauthenticated',
        401,
      );
    }
    const reads = (receiptReads.get(params.id) ?? 0) + 1;
    receiptReads.set(params.id, reads);
    if (params.id.startsWith('e2e-flow-receipt-down-') && reads > 1) {
      return new HttpResponse(null, { status: 503 });
    }
    return HttpResponse.json({
      group: {
        meta: { type: 'entity', entity: 'checkout-group' },
        data: {
          id: params.id,
          number: numberOf(params.id),
          contact: [contacts.get(params.id)],
          placedAt: '2026-11-03T00:00:00.000Z',
          // ⚠️ Server-stamped, and only for a group that brought a digest. It
          // is what turns the nonce the action minted into a capability the
          // receipt may offer.
          cancelWindowEndsAt: params.id.startsWith('e2e-flow-cancel-closed-')
            ? CANCEL_CLOSED_AT
            : CANCEL_WINDOW_ENDS_AT,
          receiptEndsAt: RECEIPT_ENDS_AT,
          orderIds: vendors.map(part => orderIdOf(params.id, part.vendorId)),
        },
      },
      orders: vendors.map((part, index) => ({
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          id: orderIdOf(params.id, part.vendorId),
          number: orderNumberOf(params.id, index),
          groupId: params.id,
          vendorId: part.vendorId,
          paymentMethod: part.paymentMethod,
          // Cancelled once a cancellation the buyer started has run: the
          // receipt reads it here, as it reads it from order-service.
          status: cancellations.has(
            `e2e-cancel-${orderIdOf(params.id, part.vendorId)}`,
          )
            ? 'cancelled'
            : 'paid',
          items: part.lines,
          // The IVA the coordinator states for a general-regime seller: the
          // price includes it, so it is broken out of the gross (ADR 0078 §6).
          sellerTaxRegime: 'general',
          taxAmount: ivaIncludedIn(part.lines),
          buyerTaxIdType: 'cf',
          buyerTaxId: 'CF',
          buyerTaxName: '',
          ...receiptStateOf(params.id),
        },
      })),
    });
  },
);

/** The digest order-service stores for a nonce. */
const digestOf = nonce =>
  createHash('sha256').update(nonce, 'utf8').digest('hex');

/** The digest each redeemed group was re-keyed to, by group id. */
const rekeyedTo = new Map();

/** Tokens already spent: a link opens a receipt once. */
const spentTokens = new Set();

/**
 * Where a mailed access link is redeemed. A token in this suite is
 * `e2e-token-<flowId>`, so the journey that mails nothing can still hold one;
 * it works once, for a flow that was started, and re-keys that group to the
 * digest the storefront sent.
 */
const ACCESS_URL = 'http://localhost:3105/api/checkout-group/access';
const accessHandler = http.post(ACCESS_URL, async ({ request }) => {
  const body = await request.json().catch(() => undefined);
  const token = typeof body?.token === 'string' ? body.token : '';
  const flowId = token.startsWith('e2e-token-') ? token.slice(10) : '';
  if (!baskets.has(flowId) || spentTokens.has(token)) {
    return problem(
      'CancelNotAuthorized',
      'cancelNotAuthorized',
      'unauthenticated',
      401,
    );
  }
  spentTokens.add(token);
  rekeyedTo.set(flowId, String(body.capabilityDigest));
  return HttpResponse.json({ id: flowId });
});

/**
 * "Find my order": answered `202` whatever was asked, as order-service
 * answers it — but only to the storefront's own token, so a storefront that
 * sent the coordinator's would fail here as it would live.
 */
const LOOKUP_URL = 'http://localhost:3105/api/checkout-group/send-access-link';
const lookupHandler = http.post(LOOKUP_URL, ({ request }) =>
  request.headers.get('x-crossing-token') ===
  'dev-storefront-lookup-token-change-me'
    ? HttpResponse.json({ accepted: true }, { status: 202 })
    : problem('Unauthenticated', 'unauthenticated', 'unauthenticated', 401),
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

/** A vendor read naming `SELLER_DOWN_VENDOR` reaches a backend that is down. */
const sellerDownHandler = http.get(
  `${SERVICE_URL}/published-vendor`,
  ({ request }) =>
    decodeURIComponent(new URL(request.url).search).includes(SELLER_DOWN_VENDOR)
      ? new HttpResponse(null, { status: 503 })
      : undefined,
);

/**
 * The seed's pictures, as the image optimizer fetches them (#571). The
 * browser never asks picsum for anything any more — it asks the storefront's
 * `/_next/image` — so the fetch happens here, in the Next process, and an
 * unhandled one would leave this hermetic profile for the real host. Every
 * picture is the same one grey pixel.
 */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/58BAwAI/AL+XJ/PNgAAAABJRU5ErkJggg==',
  'base64',
);

const pictureHandler = http.get(
  'https://picsum.photos/*',
  () =>
    new HttpResponse(PIXEL, {
      headers: { 'content-type': 'image/png' },
    }),
);

setupServer(
  unavailableHandler,
  pictureHandler,
  sellerDownHandler,
  buyerCancelHandler,
  buyerReceiptHandler,
  accessHandler,
  lookupHandler,
  configurationHandler(CONFIG_URL, CONFIGURATION),
  checkoutHandler,
  flowStatusHandler,
  ...collections.flatMap(({ handlers }) => handlers),
).listen({
  // Next serves its own documents, RSC payloads and static assets over this
  // same `fetch`. Only the service origins above are ours to answer.
  onUnhandledRequest: 'bypass',
});
