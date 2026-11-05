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
 * A vendor's `cancel` and their `dispatch` fired at one cash-on-delivery order
 * at once (ADR 0070): two flows, two slices, one shipment. Every move on a
 * shipment is one conditional write on the status it leaves, and the
 * cancellation holds the shipment before its own pivot — so exactly one of the
 * two may win, and the loser must leave nothing behind.
 *
 * A sequential pass proves none of that, which is why this is a burst.
 */
const ORDERS = Number(process.env['LIVE_RACE_ORDERS'] ?? 10);

afterAll(closeMongo);

it(`lets exactly one of cancel and dispatch win, ${String(ORDERS)} orders over`, async () => {
  const offering = await sellable(DEMO.organizationId, ORDERS);
  const bearer = await vendorBearer(DEMO.organizationId);

  // The orders, placed one by one so each race starts from a settled order.
  const placed: string[] = [];
  for (let n = 0; n < ORDERS; n++) {
    const checkout = await startCheckout([
      {
        vendorId: DEMO.organizationId,
        paymentMethod: 'cod',
        lines: [
          {
            offeringId: offering.offeringId,
            quantity: 1,
            amount: offering.amount,
          },
        ],
      },
    ]);
    expect(checkout.status).toBe(202);
    const done = await settled(checkout.flowId, {
      capability: checkout.capability,
    });
    expect(done.state).toBe('completed');
    const [order] = await ordersOf(checkout.flowId);
    placed.push(String(order?.['id']));
  }

  // The races: both verbs on every order, all at once.
  const answers = await Promise.all(
    placed.flatMap(orderId => [
      fetch(`${FLEET.order}/api/product-order/${orderId}/cancel`, {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: '{}',
      }).then(async res => ({
        orderId,
        verb: 'cancel',
        status: res.status,
        body: await res.json(),
      })),
      fetch(`${FLEET.fulfilment}/api/shipping-order/${orderId}/dispatch`, {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: '{}',
      }).then(async res => ({
        orderId,
        verb: 'dispatch',
        status: res.status,
        body: await res.json(),
      })),
    ]),
  );

  // Every accepted verb runs a flow; wait for each to end or to park past its
  // commit point — a dispatched parcel waits days on the courier.
  await Promise.all(
    answers
      .filter(answer => answer.status === 202)
      .map(answer =>
        settled(
          (answer.body as { data: { flowId: string } }).data.flowId,
          { bearer },
          { orWaiting: true },
        ),
      ),
  );

  const shipments = (
    await mongo(`fulfilment_${DEMO.organizationId}`)
  ).collection('shipping-order');
  const orders = (await mongo('order')).collection('product-order');
  const outcomes = await Promise.all(
    placed.map(async orderId => {
      const shipment = await shipments.findOne({ id: orderId });
      const order = await orders.findOne({ id: orderId });
      return {
        orderId,
        shipment: String(shipment?.['status']),
        order: String(order?.['status']),
      };
    }),
  );

  for (const outcome of outcomes) {
    const cancelled =
      outcome.order === 'cancelled' && outcome.shipment === 'withdrawn';
    const dispatched =
      outcome.order === 'dispatched' && outcome.shipment === 'dispatched';
    // One winner, and the loser left nothing half-done: never a dispatched
    // parcel on a cancelled order, never a withdrawn one on a live order.
    expect(
      { ...outcome, oneWinner: cancelled !== dispatched },
      `cancel vs dispatch on ${outcome.orderId}`,
    ).toMatchObject({ oneWinner: true });
  }
  console.info(
    'cancel vs dispatch',
    JSON.stringify({
      cancelled: outcomes.filter(o => o.order === 'cancelled').length,
      dispatched: outcomes.filter(o => o.order === 'dispatched').length,
      refused: answers
        .filter(a => a.status !== 202)
        .map(a => `${a.verb}:${String(a.status)}`),
    }),
  );
});
