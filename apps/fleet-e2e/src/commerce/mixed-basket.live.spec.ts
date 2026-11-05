import {
  closeMongo,
  DEMO,
  eventually,
  FLEET,
  mongo,
  ordersOf,
  SECOND,
  sellable,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * One basket across both seeded vendors (ADR 0069): the demo vendor paid by
 * card, the second paid in cash on delivery (ADR 0070). One checkout group,
 * one order per vendor, one capture allocated to the card order — and a
 * settlement ledger that prices each vendor at its own agreement, joining the
 * sale to whichever payment it got: the capture for one, the courier's
 * collection for the other.
 */
afterAll(closeMongo);

const AGREEMENT_BASIS_POINTS = 800;
const cutOf = (gross: number) =>
  Math.round((gross * AGREEMENT_BASIS_POINTS) / 10_000);

it('settles a basket spanning two vendors, each at its own cut', async () => {
  const card = await sellable(DEMO.organizationId);
  const cod = await sellable(SECOND.organizationId);

  const checkout = await startCheckout([
    {
      vendorId: DEMO.organizationId,
      paymentMethod: 'card',
      lines: [
        { offeringId: card.offeringId, quantity: 1, amount: card.amount },
      ],
    },
    {
      vendorId: SECOND.organizationId,
      paymentMethod: 'cod',
      lines: [{ offeringId: cod.offeringId, quantity: 1, amount: cod.amount }],
    },
  ]);
  expect(checkout.status).toBe(202);
  expect(
    (await settled(checkout.flowId, { capability: checkout.capability })).state,
  ).toBe('completed');

  const orders = await ordersOf(checkout.flowId);
  expect(orders.map(order => order['vendorId']).sort()).toEqual(
    [DEMO.organizationId, SECOND.organizationId].sort(),
  );
  const orderOf = (vendorId: string) =>
    String(orders.find(order => order['vendorId'] === vendorId)?.['id']);
  const cardOrder = orderOf(DEMO.organizationId);
  const codOrder = orderOf(SECOND.organizationId);

  // One capture, allocated to the card order alone.
  const allocations = await (
    await mongo('payment')
  )
    .collection('payment-allocation')
    .find({ orderId: { $in: [cardOrder, codOrder] } })
    .toArray();
  expect(allocations.map(allocation => allocation['orderId'])).toEqual([
    cardOrder,
  ]);
  expect(Number(allocations[0]?.['captured'])).toBe(card.amount);

  // The cash order ships and is delivered: the second vendor dispatches, the
  // courier reports, and the delivery flow records the cash collected.
  const bearer = await vendorBearer(SECOND.organizationId);
  const dispatched = await fetch(
    `${FLEET.fulfilment}/api/shipping-order/${codOrder}/dispatch`,
    {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: '{}',
    },
  );
  expect(dispatched.status).toBe(202);
  const delivery = ((await dispatched.json()) as { data: { flowId: string } })
    .data.flowId;
  await settled(delivery, { bearer }, { orWaiting: true });
  const reported = await fetch(
    `${FLEET.fulfilment}/api/shipping-order/${codOrder}/record-delivery`,
    {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: '{}',
    },
  );
  expect(reported.status).toBeLessThan(300);
  expect((await settled(delivery, { bearer })).state).toBe('completed');

  // The ledger: one sale line per vendor order, each priced at its agreement.
  const entries = await eventually(
    async () =>
      (await mongo('settlement'))
        .collection('commission-entry')
        .find({ orderId: { $in: [cardOrder, codOrder] }, kind: 'sale' })
        .toArray(),
    rows => rows.length === 2,
    { timeoutMs: 60_000, what: 'both vendors’ sale lines' },
  );
  const lineOf = (orderId: string) =>
    entries.find(entry => entry['orderId'] === orderId);

  expect(lineOf(cardOrder)).toMatchObject({
    vendorId: DEMO.organizationId,
    saleAmount: card.amount,
    commissionAmount: cutOf(card.amount),
    collectedBy: 'platform',
  });
  // The vendor holds the cash, so the platform's cut is what it is owed.
  expect(lineOf(codOrder)).toMatchObject({
    vendorId: SECOND.organizationId,
    saleAmount: cod.amount,
    commissionAmount: cutOf(cod.amount),
    collectedBy: 'vendor',
  });

  const statuses = await (
    await mongo('order')
  )
    .collection('product-order')
    .find({ id: { $in: [cardOrder, codOrder] } })
    .toArray();
  console.info(
    'mixed basket',
    JSON.stringify({
      orders: statuses.map(
        order => `${String(order['vendorId'])}:${String(order['status'])}`,
      ),
      entries: entries.map(entry => ({
        vendorId: entry['vendorId'],
        sale: entry['saleAmount'],
        cut: entry['commissionAmount'],
        collectedBy: entry['collectedBy'],
      })),
    }),
  );
});
