import { randomBytes } from 'node:crypto';

import {
  closeMongo,
  configValue,
  eventually,
  FLEET,
  HARDWARE,
  mongo,
  ordersOf,
  PHONE,
  recordGuide,
  sellable,
  settled,
  SHOEMAKING,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * The MVP flow, live, once per vertical (#691): each sample store sells what
 * it sells — a piece, and, where the store sells by measure, a line in its
 * unit — is paid the way that store is paid, ships with a guide, is
 * delivered by the lab's courier, is certified with its FEL document and
 * lands in the vendor's commission ledger.
 *
 * Hardware takes a payment link the seller confirms (ADR 0081); phones are
 * paid by card; shoemaking is cash on delivery (ADR 0070). The races these
 * paths are exposed to are their own specs: confirm against expiry in
 * `confirm-vs-withdraw`, attach against cancel in `attach-vs-cancel`.
 */
afterAll(closeMongo);

const VERTICALS = [
  { name: 'hardware', vendor: HARDWARE, paymentMethod: 'link' },
  { name: 'phone accessories', vendor: PHONE, paymentMethod: 'card' },
  { name: 'shoemaking supplies', vendor: SHOEMAKING, paymentMethod: 'cod' },
] as const;

/**
 * The store's first published offering sold in a unit that is not a piece,
 * at the least it sells (ADR 0082): `undefined` for a store that sells only
 * pieces.
 */
const measuredLine = async (organizationId: string) => {
  const offering = await (
    await mongo('marketplace')
  )
    .collection('published-offering')
    .findOne({
      vendorId: organizationId,
      currency: 'GTQ',
      saleUnit: { $ne: 'UN' },
      // A presentation draws on another's stock; its own journey is
      // `presentation.live.spec.ts`.
      stockOfferingId: { $exists: false },
    });
  if (offering === null) return undefined;
  return {
    offeringId: String(offering['offeringId']),
    amount: Number(offering['amount']),
    quantity: Number(offering['quantityMinimum'] ?? 1000),
  };
};

const post = (url: string, bearer: string, body: unknown = {}) =>
  fetch(url, {
    method: 'POST',
    headers: {
      authorization: bearer,
      'content-type': 'application/json',
      'idempotency-key': `"${randomBytes(16).toString('hex')}"`,
    },
    body: JSON.stringify(body),
  });

describe.each(VERTICALS)('$name', ({ vendor, paymentMethod }) => {
  it(`sells, is paid by ${paymentMethod}, ships, delivers and is certified`, async () => {
    const organizationId = vendor.organizationId;
    const bearer = await vendorBearer(organizationId);
    const piece = await sellable(organizationId, 1);
    const measured = await measuredLine(organizationId);
    const orders = (await mongo('order')).collection('product-order');

    const checkout = await startCheckout([
      {
        vendorId: organizationId,
        paymentMethod,
        lines: [
          { offeringId: piece.offeringId, quantity: 1, amount: piece.amount },
          ...(measured === undefined ? [] : [measured]),
        ],
      },
    ]);
    expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
    const auth = { capability: checkout.capability };
    // A link order parks on the seller's decision; the others end.
    const first = await settled(checkout.flowId, auth, { orWaiting: true });
    const [order] = await ordersOf(checkout.flowId);
    const orderId = String(order?.['id']);

    if (paymentMethod === 'link') {
      expect(first.state).toBe('waiting');
      expect((await orders.findOne({ id: orderId }))?.['status']).toBe(
        'awaiting-payment',
      );
      const confirmed = await post(
        `${FLEET.order}/api/product-order/${orderId}/confirm-payment`,
        bearer,
        { reference: `AUTH-${orderId.slice(0, 6)}` },
      );
      expect(confirmed.status).toBe(200);
    }
    expect((await settled(checkout.flowId, auth)).state).toBe('completed');

    // Lines as sold: the measured one keeps its unit (ADR 0082).
    const placed = await orders.findOne({ id: orderId });
    expect(placed?.['items']).toHaveLength(measured === undefined ? 1 : 2);

    // The guide, then the dispatch the delivery flow carries out.
    expect((await recordGuide(orderId, bearer)).status).toBe(200);
    const dispatched = await post(
      `${FLEET.fulfilment}/api/shipping-order/${orderId}/dispatch`,
      bearer,
    );
    expect(dispatched.status).toBe(202);

    const delaySeconds = Number(
      await configValue(
        'fulfilment-service',
        'fulfilment',
        'courierSimulatorDelaySeconds',
      ),
    );
    const delivered = await eventually(
      () => orders.findOne({ id: orderId }),
      row => row?.['status'] === 'fulfilled',
      {
        timeoutMs: (delaySeconds + 120) * 1000,
        what: `the ${vendor.slug} parcel to be delivered`,
      },
    );
    expect(delivered?.['trackingNumber']).toEqual(expect.any(String));

    // Its FEL document, once paid — for cash on delivery, once collected.
    const fiscalSweepMs = Number(
      await configValue('order-service', 'order', 'fiscalSweepMs'),
    );
    await eventually(
      () => orders.findOne({ id: orderId }),
      row => typeof row?.['fiscalAuthorization'] === 'string',
      {
        timeoutMs: fiscalSweepMs * 3 + 60_000,
        what: `the ${vendor.slug} order to be certified`,
      },
    );

    // And the sale in the vendor's ledger, priced at its agreement.
    const [entry] = await eventually(
      async () =>
        (await mongo('settlement'))
          .collection('commission-entry')
          .find({ orderId, kind: 'sale' })
          .toArray(),
      rows => rows.length === 1,
      { timeoutMs: 60_000, what: `the ${vendor.slug} sale line` },
    );
    expect(entry?.['vendorId']).toBe(organizationId);
  }, 600_000);
});
