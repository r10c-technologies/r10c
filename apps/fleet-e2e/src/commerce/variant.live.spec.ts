import {
  closeMongo,
  eventually,
  FLEET,
  mongo,
  offeringIdOf,
  PHONE,
  present,
  settled,
  SHOEMAKING,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * A product sold in variants, on the real fleet (ADR 0085): the phone store's
 * silicone case in black, blue and pink, each its own offering with its own
 * stock; a storefront search that matches every word; and two variants racing
 * for one colour, which leaves exactly one winner.
 */
afterAll(closeMongo);

const BLACK = offeringIdOf(PHONE, 'funda-silicon-a15');
const BLUE = offeringIdOf(PHONE, 'funda-silicon-a15-azul');
const PINK = offeringIdOf(PHONE, 'funda-silicon-a15-rosa');
const BROWN_42 = offeringIdOf(SHOEMAKING, 'suela-hule-caballero-cafe-42');

const MARKETPLACE =
  process.env['MARKETPLACE_SERVICE_URL'] ?? 'http://localhost:3100';
const STOCK_DB = `stock_${PHONE.organizationId}`;

const published = async (offeringId: string) =>
  present(
    (await (
      await mongo('marketplace')
    )
      .collection('published-offering')
      .findOne({ offeringId })) ?? undefined,
    `${offeringId} published — reset the lab (pnpm run mp:dev:reset)`,
  );

const stockItem = async (offeringId: string) =>
  present(
    (await (
      await mongo(STOCK_DB)
    )
      .collection('stock-item')
      .findOne({ offeringId })) ?? undefined,
    `a stock item for ${offeringId}`,
  );

/** The storefront's search, as the projection's read path answers it. */
const search = async (term: string) => {
  const rsql = term
    .split(/\s+/)
    .map(word => `searchText=like='${word}'`)
    .join(';');
  const res = await fetch(
    `${MARKETPLACE}/api/published-offering?rsql=${encodeURIComponent(rsql)}&pageSize=50`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { items: { offeringId: string }[] };
  };
  return body.data.items.map(item => item.offeringId);
};

const setVariant = async (offeringId: string, color: string) =>
  fetch(
    `${FLEET.marketplaceAdmin}/api/product-offering/${offeringId}/set-variant`,
    {
      method: 'POST',
      headers: {
        authorization: await vendorBearer(PHONE.organizationId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        variantValues: [{ axis: 'color', value: color }],
      }),
    },
  );

it('publishes three colours of one product, each with its own picture', async () => {
  const cases = await Promise.all([BLACK, BLUE, PINK].map(published));

  expect(new Set(cases.map(one => one['variantGroup'])).size).toBe(1);
  expect(cases.map(one => one['variantValues'])).toEqual([
    [{ axis: 'color', value: 'negro' }],
    [{ axis: 'color', value: 'azul' }],
    [{ axis: 'color', value: 'rosa' }],
  ]);
  expect(
    new Set(cases.map(one => (one['media'] as { url: string }[])[0]?.url)).size,
  ).toBe(3);
});

it('finds a variant by a word only its values hold', async () => {
  expect(await search('funda azul')).toEqual([BLUE]);
  // Accent- and case-blind, in any order.
  expect(await search('42 CAFE suela')).toEqual([BROWN_42]);
});

it('sells a colour from its own stock', async () => {
  const blackBefore = await stockItem(BLACK);
  const blueBefore = await stockItem(BLUE);
  const amount = Number((await published(BLUE))['amount']);

  const checkout = await startCheckout([
    {
      vendorId: PHONE.organizationId,
      paymentMethod: 'cod',
      lines: [{ offeringId: BLUE, quantity: 1, amount }],
    },
  ]);
  expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
  const status = await settled(checkout.flowId, {
    capability: checkout.capability,
  });
  expect(status.state).toBe('completed');

  // A completed checkout converts its hold: the blue case leaves the shelf.
  const blueAfter = await eventually(
    () => stockItem(BLUE),
    item => Number(item['onHand']) !== Number(blueBefore['onHand']),
    { timeoutMs: 30_000, what: 'the blue case sold' },
  );
  expect(Number(blueAfter['onHand'])).toBe(Number(blueBefore['onHand']) - 1);
  const blackAfter = await stockItem(BLACK);
  expect(blackAfter['reserved']).toEqual(blackBefore['reserved']);
  expect(blackAfter['onHand']).toEqual(blackBefore['onHand']);
});

it('refuses a colour a sibling already takes', async () => {
  const res = await setVariant(BLUE, 'NEGRO');

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({
    code: 'variantInvalid',
    problem: 'combinationTaken',
  });
});

it('leaves one winner when two variants race for one colour', async () => {
  const color = `verde-${String(Date.now())}`;
  try {
    const [blue, pink] = await Promise.all([
      setVariant(BLUE, color),
      setVariant(PINK, color),
    ]);
    const statuses = [blue.status, pink.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = blue.status === 400 ? blue : pink;
    expect(await loser.json()).toMatchObject({ problem: 'combinationTaken' });

    const slots = await (
      await mongo(`tenant_${PHONE.organizationId}`)
    )
      .collection('product-offering-variant-slot')
      .find({ slot: { $regex: `color=${color}$` } })
      .toArray();
    expect(slots).toHaveLength(1);
  } finally {
    // Put the seeded colours back, whichever won.
    await setVariant(BLUE, 'azul');
    await setVariant(PINK, 'rosa');
  }
});
