import { randomBytes } from 'node:crypto';

import {
  closeMongo,
  crossingHeaders,
  eventually,
  FLEET,
  HARDWARE,
  mongo,
  offeringIdOf,
  ordersOf,
  present,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * A presentation sold from its base's stock, on the real fleet (ADR 0082 §7):
 * the hardware store's 100 m roll draws on the cable by the metre, and its box
 * of 500 on the loose screws. A roll reserves 100 m of the cable, a
 * cancellation puts back exactly what the order copied, and a burst of rolls
 * and loose metres over the last of the cable leaves the base never short and
 * nothing a loser could still have taken.
 */
afterAll(closeMongo);

const METRE = offeringIdOf(HARDWARE, 'cable-thhn-12');
const ROLL = offeringIdOf(HARDWARE, 'cable-thhn-12-rollo');
const PER_HUNDRED = offeringIdOf(HARDWARE, 'tornillo-madera-8');
const BOX = offeringIdOf(HARDWARE, 'tornillo-madera-8-caja');

/** 100 m in the cable's scale. */
const ROLL_TAKES = 100_000;
/** 25 m of loose cable: a multiple of its half-metre step. */
const LOOSE = 25_000;

const STOCK_DB = `stock_${HARDWARE.organizationId}`;

const key = () => `"${randomBytes(16).toString('hex')}"`;

const published = async (offeringId: string) =>
  present(
    (await (
      await mongo('marketplace')
    )
      .collection('published-offering')
      .findOne({ offeringId })) ?? undefined,
    `${offeringId} published — reset the lab (pnpm run back-office:dev:reset)`,
  );

const stockItem = async (offeringId: string) =>
  (await mongo(STOCK_DB)).collection('stock-item').findOne({ offeringId });

/** What the base can still be reserved for. */
const free = async (offeringId: string) => {
  const item = present(
    (await stockItem(offeringId)) ?? undefined,
    `a stock item for ${offeringId}`,
  );
  return Number(item['onHand']) - Number(item['reserved']);
};

const cancel = async (orderId: string) => {
  const res = await fetch(
    `${FLEET.order}/api/product-order/${orderId}/cancel`,
    {
      method: 'POST',
      headers: {
        authorization: await vendorBearer(HARDWARE.organizationId),
        'content-type': 'application/json',
      },
      body: '{}',
    },
  );
  expect(res.status).toBeLessThan(300);
  return eventually(
    async () =>
      (await mongo(STOCK_DB))
        .collection('stock-movement')
        .find({ causeId: orderId, reason: 'cancellation' })
        .toArray(),
    rows => rows.length > 0,
    { timeoutMs: 60_000, what: `the restoration of ${orderId}` },
  );
};

/** A cash-on-delivery checkout of `quantity` of one offering. */
const buy = async (offeringId: string, quantity: number) => {
  const amount = Number((await published(offeringId))['amount']);
  const checkout = await startCheckout([
    {
      vendorId: HARDWARE.organizationId,
      paymentMethod: 'cod',
      lines: [{ offeringId, quantity, amount }],
    },
  ]);
  expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
  const status = await settled(checkout.flowId, {
    capability: checkout.capability,
  });
  return { flowId: checkout.flowId, state: status.state };
};

it('publishes the roll drawing on the cable, with no stock of its own', async () => {
  expect(await published(ROLL)).toMatchObject({
    saleUnit: 'UN',
    stockOfferingId: METRE,
    stockFactor: ROLL_TAKES,
    stockUnit: 'M',
  });
  expect(await stockItem(ROLL)).toBeNull();
});

it('takes 100 m of the cable for a roll, and a cancellation puts exactly that back', async () => {
  const before = await free(METRE);

  const sale = await buy(ROLL, 1);
  expect(sale.state).toBe('completed');
  const [order] = await ordersOf(sale.flowId);
  expect(order?.['items']).toMatchObject([
    {
      offeringId: ROLL,
      saleUnit: 'UN',
      quantity: 1,
      stockOfferingId: METRE,
      stockUnit: 'M',
      stockQuantity: ROLL_TAKES,
    },
  ]);
  expect(await free(METRE)).toBe(before - ROLL_TAKES);

  const restored = await cancel(String(order?.['id']));
  expect(restored).toMatchObject([
    { offeringId: METRE, unit: 'M', quantity: ROLL_TAKES },
  ]);
  expect(await free(METRE)).toBe(before);
});

it('sells the box of 500 at the till from the loose screws', async () => {
  const bearer = await vendorBearer(HARDWARE.organizationId);
  const before = await free(PER_HUNDRED);

  const sold = await fetch(
    `${FLEET.sales}/api/sales-channel/sales-channel-counter/sell`,
    {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
        'idempotency-key': key(),
      },
      body: JSON.stringify({
        paymentMethod: 'cash',
        lines: [{ offeringId: BOX, quantity: 2 }],
      }),
    },
  );
  expect(sold.status).toBe(202);
  const flowId = String(
    ((await sold.json()) as { data?: { flowId?: string } }).data?.flowId,
  );
  expect((await settled(flowId, { bearer })).state).toBe('completed');
  const [order] = await ordersOf(flowId);
  expect(order?.['items']).toMatchObject([
    { offeringId: BOX, stockOfferingId: PER_HUNDRED, stockQuantity: 1000 },
  ]);
  expect(await free(PER_HUNDRED)).toBe(before - 1000);
});

it('lets a burst of rolls and loose metres over the last of the cable take only what there is', async () => {
  // Hold all but two and a half rolls' worth, so the burst competes for
  // exactly that much and the rest of the lab keeps its cable.
  const LEFT = 250_000;
  const padding = (await free(METRE)) - LEFT;
  expect(padding).toBeGreaterThan(0);
  const stockHeaders = {
    ...(await crossingHeaders('stock-service')),
    'x-organization-id': HARDWARE.organizationId,
  };
  const held = await fetch(`${FLEET.stock}/api/reservation`, {
    method: 'POST',
    headers: { ...stockHeaders, 'idempotency-key': key() },
    body: JSON.stringify({ offeringId: METRE, unit: 'M', quantity: padding }),
  });
  expect(held.status).toBeLessThan(300);
  const holdId = String(
    ((await held.json()) as { data?: { id?: string } }).data?.id,
  );

  try {
    // 350 m asked of 250 m: three rolls and two lots of 25 m, all at once.
    const asks = [
      { offeringId: ROLL, quantity: 1, takes: ROLL_TAKES },
      { offeringId: ROLL, quantity: 1, takes: ROLL_TAKES },
      { offeringId: ROLL, quantity: 1, takes: ROLL_TAKES },
      { offeringId: METRE, quantity: LOOSE, takes: LOOSE },
      { offeringId: METRE, quantity: LOOSE, takes: LOOSE },
    ];
    const outcomes = await Promise.all(
      asks.map(async ask => ({
        ...ask,
        ...(await buy(ask.offeringId, ask.quantity)),
      })),
    );
    const won = outcomes.filter(outcome => outcome.state === 'completed');
    const lost = outcomes.filter(outcome => outcome.state !== 'completed');
    const taken = won.reduce((sum, outcome) => sum + outcome.takes, 0);

    expect(won.length).toBeGreaterThan(0);
    expect(lost.length).toBeGreaterThan(0);
    expect(taken).toBeLessThanOrEqual(LEFT);
    // One balance: what is left is exactly what the winners did not take,
    // and no loser asked for less than that.
    const left = await free(METRE);
    expect(left).toBe(LEFT - taken);
    for (const loser of lost) expect(loser.takes).toBeGreaterThan(left);
    expect(await stockItem(ROLL)).toBeNull();

    // Put the winners back, so the lab keeps its cable.
    for (const winner of won) {
      const [order] = await ordersOf(winner.flowId);
      await cancel(String(order?.['id']));
    }
    expect(await free(METRE)).toBe(LEFT);
  } finally {
    await fetch(`${FLEET.stock}/api/reservation/${holdId}`, {
      method: 'DELETE',
      headers: { ...stockHeaders, 'idempotency-key': key() },
    });
  }
});
