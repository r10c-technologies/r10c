import { randomBytes } from 'node:crypto';

import { lineTotal } from '@r10c/business-ts-sales-vocabulary';

import {
  closeMongo,
  crossingHeaders,
  DEMO,
  eventually,
  FLEET,
  mongo,
  ordersOf,
  present,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * Selling in a unit that is not a piece, on the real fleet (ADR 0082): the
 * seed's cable sold by the half metre from a metre, and its part priced per
 * hundred. Every figure after placement is the line's `lineTotal`, computed
 * once — the order, the capture, the commission and the receipt mail agree to
 * the centavo — and stock moves in the item's own unit, back as well as out.
 *
 * Then the races only a burst shows: holds on the last metres leave exactly
 * the metres there were, and two first movements in different units leave one
 * unit on the item.
 */
afterAll(closeMongo);

/** The demo vendor's cable, Q64.99 the metre, by the half metre from one. */
const METRE = 'product-offering-10';
/** The demo vendor's part, Q124.99 the hundred, by the piece. */
const PER_HUNDRED = 'product-offering-22';

const STOCK_DB = `stock_${DEMO.organizationId}`;
const AGREEMENT_BASIS_POINTS = 800;

const published = async (offeringId: string) => {
  const found = await (
    await mongo('marketplace')
  )
    .collection('published-offering')
    .findOne({ offeringId });
  return present(
    found ?? undefined,
    `${offeringId} published — reset the lab (pnpm run back-office:dev:reset)`,
  );
};

const stockOf = async (offeringId: string) => {
  const found = await (
    await mongo(STOCK_DB)
  )
    .collection('stock-item')
    .findOne({ offeringId });
  return present(found ?? undefined, `a stock item for ${offeringId}`);
};

const key = () => `"${randomBytes(16).toString('hex')}"`;

it('sells 3.5 m by card at its line total, end to end', async () => {
  const cable = await published(METRE);
  expect(cable).toMatchObject({
    saleUnit: 'M',
    quantityStep: 500,
    quantityMinimum: 1000,
    pricePer: 1,
    currency: 'GTQ',
  });
  const amount = Number(cable['amount']);
  const expected = lineTotal({
    amount,
    quantity: 3500,
    saleUnit: 'M',
    pricePer: 1,
  });
  const before = await stockOf(METRE);
  expect(before['unit']).toBe('M');

  const checkout = await startCheckout([
    {
      vendorId: DEMO.organizationId,
      paymentMethod: 'card',
      lines: [{ offeringId: METRE, quantity: 3500, amount }],
    },
  ]);
  expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
  expect(
    (await settled(checkout.flowId, { capability: checkout.capability })).state,
  ).toBe('completed');

  const [order] = await ordersOf(checkout.flowId);
  const orderId = String(order?.['id']);
  expect(order?.['items']).toMatchObject([
    {
      offeringId: METRE,
      saleUnit: 'M',
      quantity: 3500,
      pricePer: 1,
      lineTotal: expected,
    },
  ]);
  expect(order?.['totalAmount']).toBe(expected);

  // The capture took the line total, never 3500 × the metre's price.
  const [allocation] = await (
    await mongo('payment')
  )
    .collection('payment-allocation')
    .find({ orderId })
    .toArray();
  expect(Number(allocation?.['captured'])).toBe(expected);

  // The hold converted to a sale of exactly 3.5 m, in metres.
  const after = await eventually(
    () => stockOf(METRE),
    item => Number(item['onHand']) === Number(before['onHand']) - 3500,
    { timeoutMs: 30_000, what: 'the sale of 3.5 m on the ledger' },
  );
  expect(after).toMatchObject({ unit: 'M', reserved: before['reserved'] });

  // The commission is priced on the line total.
  const [entry] = await eventually(
    async () =>
      (await mongo('settlement'))
        .collection('commission-entry')
        .find({ orderId, kind: 'sale' })
        .toArray(),
    rows => rows.length === 1,
    { timeoutMs: 60_000, what: 'the sale’s commission line' },
  );
  expect(entry).toMatchObject({
    saleAmount: expected,
    commissionAmount: Math.round((expected * AGREEMENT_BASIS_POINTS) / 10_000),
  });
});

it('charges a part priced per hundred by the hundred', async () => {
  const part = await published(PER_HUNDRED);
  expect(part).toMatchObject({ saleUnit: 'UN', pricePer: 100 });
  const amount = Number(part['amount']);
  // 250 at Q124.99 the hundred: Q312.475, rounded half up to Q312.48.
  const expected = lineTotal({
    amount,
    quantity: 250,
    saleUnit: 'UN',
    pricePer: 100,
  });
  expect(expected).toBe(Math.round((amount * 250) / 100));

  const checkout = await startCheckout([
    {
      vendorId: DEMO.organizationId,
      paymentMethod: 'cod',
      lines: [{ offeringId: PER_HUNDRED, quantity: 250, amount }],
    },
  ]);
  expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
  expect(
    (await settled(checkout.flowId, { capability: checkout.capability })).state,
  ).toBe('completed');
  const [order] = await ordersOf(checkout.flowId);
  expect(order?.['totalAmount']).toBe(expected);
  expect(order?.['items']).toMatchObject([{ lineTotal: expected }]);
});

it('puts back exactly what a cancelled measured order took, in metres', async () => {
  const cable = await published(METRE);
  const amount = Number(cable['amount']);
  const bearer = await vendorBearer(DEMO.organizationId);
  const before = await stockOf(METRE);

  const checkout = await startCheckout([
    {
      vendorId: DEMO.organizationId,
      paymentMethod: 'cod',
      lines: [{ offeringId: METRE, quantity: 3500, amount }],
    },
  ]);
  expect(checkout.status).toBe(202);
  await settled(checkout.flowId, { capability: checkout.capability });
  const [order] = await ordersOf(checkout.flowId);
  const orderId = String(order?.['id']);

  const cancelled = await fetch(
    `${FLEET.order}/api/product-order/${orderId}/cancel`,
    {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: '{}',
    },
  );
  expect(cancelled.status).toBeLessThan(300);

  const restored = await eventually(
    async () =>
      (await mongo(STOCK_DB))
        .collection('stock-movement')
        .find({ causeId: orderId, reason: 'cancellation' })
        .toArray(),
    rows => rows.length === 1,
    { timeoutMs: 60_000, what: 'the cancellation’s restoration' },
  );
  expect(restored[0]).toMatchObject({ unit: 'M', quantity: 3500 });
  const after = await stockOf(METRE);
  expect(Number(after['onHand']) - Number(after['reserved'])).toBe(
    Number(before['onHand']) - Number(before['reserved']),
  );
});

it('refuses at the till a quantity the cable is not sold in, and sells one it is', async () => {
  const bearer = await vendorBearer(DEMO.organizationId);
  const sell = (quantity: number) =>
    fetch(`${FLEET.sales}/api/sales-channel/sales-channel-counter/sell`, {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
        'idempotency-key': key(),
      },
      body: JSON.stringify({
        paymentMethod: 'cash',
        lines: [{ offeringId: METRE, quantity }],
      }),
    });

  const offStep = await sell(1200);
  expect(offStep.status).toBe(400);
  expect(await offStep.json()).toMatchObject({ code: 'quantityOffStep' });
  const below = await sell(500);
  expect(below.status).toBe(400);
  expect(await below.json()).toMatchObject({ code: 'quantityBelowMinimum' });

  const sold = await sell(3500);
  expect(sold.status).toBe(202);
  const flowId = String(
    ((await sold.json()) as { data?: { flowId?: string } }).data?.flowId,
  );
  expect((await settled(flowId, { bearer })).state).toBe('completed');
  const cable = await published(METRE);
  const [order] = await ordersOf(flowId);
  expect(order?.['totalAmount']).toBe(
    lineTotal({
      amount: Number(cable['amount']),
      quantity: 3500,
      saleUnit: 'M',
      pricePer: 1,
    }),
  );
});

it('lets holds on the last metres take exactly the metres there are', async () => {
  const item = await stockOf(METRE);
  const free = Number(item['onHand']) - Number(item['reserved']);
  const share = Math.floor(free / 3);
  const remainder = free - share * 3;
  const hold = (quantity: number) =>
    crossingHeaders('stock-service').then(headers =>
      fetch(`${FLEET.stock}/api/reservation`, {
        method: 'POST',
        headers: {
          ...headers,
          'idempotency-key': key(),
          'x-organization-id': DEMO.organizationId,
        },
        body: JSON.stringify({ offeringId: METRE, unit: 'M', quantity }),
      }).then(async res => ({
        status: res.status,
        body: (await res.json()) as {
          code?: string;
          data?: { id?: string };
        },
      })),
    );

  // Six holds for twice what is free: three fit, three must not.
  const answers = await Promise.all(
    Array.from({ length: 6 }, () => hold(share)),
  );
  const taken = answers.filter(answer => answer.status < 300);
  expect(taken).toHaveLength(3);
  expect(
    answers
      .filter(answer => answer.status >= 300)
      .map(answer => answer.body.code),
  ).toEqual(['insufficientStock', 'insufficientStock', 'insufficientStock']);
  const held = await stockOf(METRE);
  expect(Number(held['onHand']) - Number(held['reserved'])).toBe(remainder);

  // Released, so the lab is left as it was.
  const headers = await crossingHeaders('stock-service');
  await Promise.all(
    taken.map(answer =>
      fetch(`${FLEET.stock}/api/reservation/${String(answer.body.data?.id)}`, {
        method: 'DELETE',
        headers: {
          ...headers,
          'idempotency-key': key(),
          'x-organization-id': DEMO.organizationId,
        },
      }),
    ),
  );
  expect(Number((await stockOf(METRE))['reserved'])).toBe(
    Number(item['reserved']),
  );
});

it('fixes a new item’s unit by whichever first movement wins', async () => {
  const bearer = await vendorBearer(DEMO.organizationId);
  const offeringId = `live-unit-race-${randomBytes(4).toString('hex')}`;
  const receive = (unit: 'UN' | 'M') =>
    fetch(`${FLEET.stock}/api/stock-movement`, {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({
        meta: { type: 'entity', entity: 'stock-movement' },
        data: { offeringId, unit, quantity: 5000, reason: 'receipt' },
      }),
    }).then(async res => ({
      unit,
      status: res.status,
      body: (await res.json()) as { code?: string },
    }));

  const answers = await Promise.all(
    Array.from({ length: 8 }, (_, n) => receive(n % 2 === 0 ? 'UN' : 'M')),
  );
  const item = await stockOf(offeringId);
  // Every movement in the winning unit landed; every one in the other was
  // refused `unitMismatch`, never added to a total that would mean nothing.
  for (const answer of answers) {
    if (answer.unit === item['unit']) expect(answer.status).toBeLessThan(300);
    else expect(answer.body.code).toBe('unitMismatch');
  }
  expect(item['onHand']).toBe(4 * 5000);
});
