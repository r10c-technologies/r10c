import {
  closeMongo,
  DEMO,
  FLEET,
  mongo,
  ordersOf,
  sellable,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * A payment-link order raced three ways at once (ADR 0081 §4): the seller
 * confirms the payment, the buyer withdraws the order, and its window has
 * already lapsed, so the expiry sweep may take it too. Each is one
 * conditional write on `awaiting-payment`, so the order's status is the only
 * arbiter — exactly one may win, and the flow waiting on the decision must
 * follow the winner: a confirmed order is paid, recorded as a `link` payment
 * and its stock sold; a withdrawn or expired one is cancelled and its hold
 * released.
 *
 * A sequential pass proves none of that, which is why this is a burst.
 */
const ORDERS = Number(process.env['LIVE_RACE_ORDERS'] ?? 10);

afterAll(closeMongo);

it(`lets exactly one of confirm, withdraw and expiry win, ${String(ORDERS)} orders over`, async () => {
  const offering = await sellable(DEMO.organizationId, ORDERS);
  const bearer = await vendorBearer(DEMO.organizationId);
  const stock = await mongo(`stock_${DEMO.organizationId}`);
  // A hold names no order, so this run's holds are the ones taken after now.
  const holdsBefore = new Set(
    (await stock.collection('reservation').find({}).toArray()).map(hold =>
      String(hold['id']),
    ),
  );

  // The orders, each placed until its flow parks on the seller's decision.
  const placed: { orderId: string; flowId: string; nonce: string }[] = [];
  for (let n = 0; n < ORDERS; n++) {
    const checkout = await startCheckout([
      {
        vendorId: DEMO.organizationId,
        paymentMethod: 'link',
        lines: [
          {
            offeringId: offering.offeringId,
            quantity: 1,
            amount: offering.amount,
          },
        ],
      },
    ]);
    expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
    const parked = await settled(
      checkout.flowId,
      { capability: checkout.capability },
      { orWaiting: true },
    );
    expect(parked.state).toBe('waiting');
    const [order] = await ordersOf(checkout.flowId);
    expect(order?.['status']).toBe('awaiting-payment');
    placed.push({
      orderId: String(order?.['id']),
      flowId: checkout.flowId,
      nonce: checkout.capability.nonce,
    });
  }

  // Every window lapsed already: the sweep's next pass competes too.
  const orders = (await mongo('order')).collection('product-order');
  await orders.updateMany(
    { id: { $in: placed.map(p => p.orderId) } },
    { $set: { paymentDueAt: new Date(Date.now() - 60_000) } },
  );

  // The races: the seller's confirmation and the buyer's withdrawal on every
  // order, all at once.
  const answers = await Promise.all(
    placed.flatMap(({ orderId, nonce }, n) => [
      fetch(`${FLEET.order}/api/product-order/${orderId}/confirm-payment`, {
        method: 'POST',
        headers: {
          authorization: bearer,
          'content-type': 'application/json',
          'idempotency-key': `"confirm-${orderId}"`,
        },
        body: JSON.stringify({ reference: `AUTH-${String(n)}` }),
      }).then(async res => ({
        orderId,
        verb: 'confirm',
        status: res.status,
        code: res.ok
          ? undefined
          : ((await res.json()) as { code?: string }).code,
      })),
      fetch(`${FLEET.order}/api/product-order/${orderId}/buyer-cancellation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancelNonce: nonce }),
      }).then(async res => ({
        orderId,
        verb: 'withdraw',
        status: res.status,
        code: res.ok
          ? undefined
          : ((await res.json()) as { code?: string }).code,
      })),
    ]),
  );

  // Each flow follows its order's winner to the end.
  const ends = await Promise.all(
    placed.map(({ flowId, nonce }) =>
      settled(flowId, {
        capability: { nonce, digest: '' },
      }),
    ),
  );

  const payments = (await mongo('payment')).collection('payment');
  const allocations = (await mongo('payment')).collection('payment-allocation');
  const outcomes = await Promise.all(
    placed.map(async ({ orderId }, n) => {
      const order = await orders.findOne({ id: orderId });
      const allocation = await allocations.findOne({ orderId });
      const payment =
        allocation === null
          ? null
          : await payments.findOne({ id: allocation['paymentId'] });
      return {
        orderId,
        flow: ends[n]?.state,
        order: String(order?.['status']),
        cause: order?.['cancelCause'],
        payment: payment === null ? null : String(payment['paymentMethod']),
        reference: payment?.['providerReference'],
      };
    }),
  );

  for (const [n, outcome] of outcomes.entries()) {
    const paid =
      ['paid', 'confirmed'].includes(outcome.order) &&
      outcome.payment === 'link' &&
      outcome.reference === `AUTH-${String(n)}`;
    const cancelled = outcome.order === 'cancelled' && outcome.payment === null;
    // One winner, followed all the way: never money recorded for a cancelled
    // order, never a cancelled order with money recorded.
    expect(
      { ...outcome, oneWinner: paid !== cancelled },
      `confirm vs withdraw vs expiry: ${JSON.stringify(outcome)}`,
    ).toMatchObject({ flow: 'completed', oneWinner: true });
  }
  // Every paid order's hold was converted and every cancelled one's released:
  // no hold of this run is left held, and none is spent for nothing.
  const paidCount = outcomes.filter(o => o.payment === 'link').length;
  const holds = (
    await stock.collection('reservation').find({}).toArray()
  ).filter(hold => !holdsBefore.has(String(hold['id'])));
  const holdsBy = (status: string) =>
    holds
      .filter(hold => hold['status'] === status)
      .map(hold => String(hold['id']));
  expect({
    taken: holds.length,
    converted: holdsBy('converted').length,
    released: holdsBy('released').length,
  }).toEqual({
    taken: ORDERS,
    converted: paidCount,
    released: ORDERS - paidCount,
  });

  // Each sale is a ledger line, announced from the organization's own outbox
  // as the whole fact — caused by the hold it converted (ADR 0078 §2).
  const announced = await stock
    .collection('outbox')
    .find({ 'event.name': 'stock-movement.recorded' })
    .toArray();
  const causes = announced.map(row => {
    const data = (row['event'] as { readonly data: unknown }).data as {
      readonly cause: { readonly type: string; readonly id: string };
      readonly organizationId: string;
      readonly reason: string;
    };
    return data;
  });
  for (const holdId of holdsBy('converted')) {
    expect(causes).toContainEqual(
      expect.objectContaining({
        organizationId: DEMO.organizationId,
        reason: 'sale',
        cause: { type: 'reservation', id: holdId },
      }),
    );
  }

  console.info(
    'confirm vs withdraw vs expiry',
    JSON.stringify({
      paid: outcomes.filter(o => o.payment === 'link').length,
      withdrawn: outcomes.filter(o => o.cause === 'buyer').length,
      expired: outcomes.filter(o => o.cause === 'payment-expired').length,
      refused: answers
        .filter(a => a.status >= 400)
        .map(a => `${a.verb}:${String(a.status)}:${String(a.code)}`),
    }),
  );
});

/**
 * The third writer on its own: an order nobody decided, its window lapsed,
 * cancelled by the sweep's conditional write (`order / paymentExpirySweepMs`,
 * a minute in the lab) and its flow following it to the end.
 */
it('expires an order nobody decided, and its flow releases the hold', async () => {
  const offering = await sellable(DEMO.organizationId, 1);
  const checkout = await startCheckout([
    {
      vendorId: DEMO.organizationId,
      paymentMethod: 'link',
      lines: [
        {
          offeringId: offering.offeringId,
          quantity: 1,
          amount: offering.amount,
        },
      ],
    },
  ]);
  expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
  await settled(
    checkout.flowId,
    { capability: checkout.capability },
    { orWaiting: true },
  );
  const [order] = await ordersOf(checkout.flowId);
  const orders = (await mongo('order')).collection('product-order');
  await orders.updateOne(
    { id: order?.['id'] },
    { $set: { paymentDueAt: new Date(Date.now() - 60_000) } },
  );

  const end = await settled(
    checkout.flowId,
    { capability: checkout.capability },
    { timeoutMs: 150_000 },
  );

  expect(end.state).toBe('completed');
  expect(await orders.findOne({ id: order?.['id'] })).toMatchObject({
    status: 'cancelled',
    cancelCause: 'payment-expired',
  });
}, 180_000);
