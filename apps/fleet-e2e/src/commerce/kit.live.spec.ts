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
 * A kit sold from its components' stock, on the real fleet (ADR 0086): the
 * hardware store's fixing kit holds two bags of anchors and a box of 500
 * screws, which itself draws on the loose screws. One kit holds each
 * component, a cancellation puts each back as the order copied it, and a burst
 * of kits and loose bags over the last of the anchors never oversells them.
 */
afterAll(closeMongo);

const KIT = offeringIdOf(HARDWARE, 'kit-fijacion');
const ANCHORS = offeringIdOf(HARDWARE, 'taco-fisher');
const BOX = offeringIdOf(HARDWARE, 'tornillo-madera-8-caja');
const SCREWS = offeringIdOf(HARDWARE, 'tornillo-madera-8');

/** Two bags of anchors per kit. */
const KIT_ANCHORS = 2;
/** The box of 500, from the loose screws. */
const KIT_SCREWS = 500;

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

/** What an offering's stock can still be reserved for. */
const free = async (offeringId: string) => {
  const item = present(
    (await stockItem(offeringId)) ?? undefined,
    `a stock item for ${offeringId}`,
  );
  return Number(item['onHand']) - Number(item['reserved']);
};

const cancel = async (orderId: string, restored: number) => {
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
    rows => rows.length >= restored,
    { timeoutMs: 60_000, what: `the restoration of ${orderId}` },
  );
};

/** A cash-on-delivery checkout of `quantity` of one offering, as published. */
const buy = async (offeringId: string, quantity: number) => {
  const offering = await published(offeringId);
  const checkout = await startCheckout([
    {
      vendorId: HARDWARE.organizationId,
      paymentMethod: 'cod',
      lines: [
        // The pin copies what the projection says a kit holds, as the
        // storefront does.
        { offeringId, quantity, amount: Number(offering['amount']) },
      ],
    },
  ]);
  expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
  const status = await settled(checkout.flowId, {
    capability: checkout.capability,
  });
  return { flowId: checkout.flowId, state: status.state };
};

it('publishes the kit with what one kit takes from each component, and no stock of its own', async () => {
  expect(await published(KIT)).toMatchObject({
    saleUnit: 'UN',
    kitSize: 2,
    kitComponents: [
      {
        offeringId: ANCHORS,
        quantity: KIT_ANCHORS,
        stockOfferingId: ANCHORS,
        stockUnit: 'UN',
        stockQuantity: KIT_ANCHORS,
      },
      {
        offeringId: BOX,
        quantity: 1,
        stockOfferingId: SCREWS,
        stockQuantity: KIT_SCREWS,
      },
    ],
  });
  expect(await stockItem(KIT)).toBeNull();
});

it('holds every component for a kit, and a cancellation puts each back', async () => {
  const anchors = await free(ANCHORS);
  const screws = await free(SCREWS);

  const sale = await buy(KIT, 1);
  expect(sale.state).toBe('completed');
  const [order] = await ordersOf(sale.flowId);
  expect(order?.['items']).toMatchObject([
    {
      offeringId: KIT,
      quantity: 1,
      kitComponents: [
        { offeringId: ANCHORS, stockQuantity: KIT_ANCHORS },
        { offeringId: BOX, stockOfferingId: SCREWS, stockQuantity: KIT_SCREWS },
      ],
    },
  ]);
  expect(await free(ANCHORS)).toBe(anchors - KIT_ANCHORS);
  expect(await free(SCREWS)).toBe(screws - KIT_SCREWS);

  const restored = await cancel(String(order?.['id']), 2);
  expect(restored).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ offeringId: ANCHORS, quantity: KIT_ANCHORS }),
      expect.objectContaining({ offeringId: SCREWS, quantity: KIT_SCREWS }),
    ]),
  );
  expect(await free(ANCHORS)).toBe(anchors);
  expect(await free(SCREWS)).toBe(screws);
});

it('lets a burst of kits and loose bags over the last of the anchors take only what there is', async () => {
  // Hold all but five bags, so the burst competes for exactly those.
  const LEFT = 5;
  const padding = (await free(ANCHORS)) - LEFT;
  expect(padding).toBeGreaterThan(0);
  const stockHeaders = {
    ...(await crossingHeaders('stock-service')),
    'x-organization-id': HARDWARE.organizationId,
  };
  const held = await fetch(`${FLEET.stock}/api/reservation`, {
    method: 'POST',
    headers: { ...stockHeaders, 'idempotency-key': key() },
    body: JSON.stringify({
      offeringId: ANCHORS,
      unit: 'UN',
      quantity: padding,
    }),
  });
  expect(held.status).toBeLessThan(300);
  const holdId = String(
    ((await held.json()) as { data?: { id?: string } }).data?.id,
  );

  try {
    // Eight bags asked of five: three kits and two loose bags, all at once.
    const asks = [
      { offeringId: KIT, takes: KIT_ANCHORS, restores: 2 },
      { offeringId: KIT, takes: KIT_ANCHORS, restores: 2 },
      { offeringId: KIT, takes: KIT_ANCHORS, restores: 2 },
      { offeringId: ANCHORS, takes: 1, restores: 1 },
      { offeringId: ANCHORS, takes: 1, restores: 1 },
    ];
    const outcomes = await Promise.all(
      asks.map(async ask => ({ ...ask, ...(await buy(ask.offeringId, 1)) })),
    );
    const won = outcomes.filter(outcome => outcome.state === 'completed');
    const lost = outcomes.filter(outcome => outcome.state !== 'completed');
    const taken = won.reduce((sum, outcome) => sum + outcome.takes, 0);

    expect(won.length).toBeGreaterThan(0);
    expect(lost.length).toBeGreaterThan(0);
    expect(taken).toBeLessThanOrEqual(LEFT);
    // One balance: what is left is exactly what the winners did not take, and
    // no loser asked for less than that. A losing kit released whatever
    // component it had already held.
    const left = await free(ANCHORS);
    expect(left).toBe(LEFT - taken);
    for (const loser of lost) expect(loser.takes).toBeGreaterThan(left);

    // Put the winners back, so the lab keeps its anchors and screws.
    for (const winner of won) {
      const [order] = await ordersOf(winner.flowId);
      await cancel(String(order?.['id']), winner.restores);
    }
    expect(await free(ANCHORS)).toBe(LEFT);
  } finally {
    await fetch(`${FLEET.stock}/api/reservation/${holdId}`, {
      method: 'DELETE',
      headers: { ...stockHeaders, 'idempotency-key': key() },
    });
  }
});
