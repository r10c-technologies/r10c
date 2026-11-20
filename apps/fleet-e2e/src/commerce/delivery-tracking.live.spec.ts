import {
  closeMongo,
  configValue,
  DEMO,
  eventually,
  FLEET,
  mongo,
  ordersOf,
  recordGuide,
  sellable,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';
import { openStream, payloads } from '../support/stream';

/**
 * The buyer follows a parcel to the door (ADR 0081 §11–§12, #669 #670): a
 * dispatch is refused until the vendor records the guide; the dispatched
 * order carries the guide the buyer reads; the buyer's open receipt hears the
 * dispatch and the delivery by push on its receipt digest; and the lab's
 * simulated courier reports the delivery through the vendor's own move.
 *
 * Then a burst: relabelling and dispatching one parcel at once leaves the
 * order with exactly the guide the shipment left with.
 */
afterAll(closeMongo);

const codCheckout = async () => {
  const offering = await sellable(DEMO.organizationId, 1);
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
  expect(
    (await settled(checkout.flowId, { capability: checkout.capability })).state,
  ).toBe('completed');
  const [order] = await ordersOf(checkout.flowId);
  return { checkout, orderId: String(order?.['id']) };
};

const dispatch = (orderId: string, bearer: string) =>
  fetch(`${FLEET.fulfilment}/api/shipping-order/${orderId}/dispatch`, {
    method: 'POST',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    body: '{}',
  });

it('refuses a dispatch without a guide, then follows the parcel to the door by push', async () => {
  const bearer = await vendorBearer(DEMO.organizationId);
  const { checkout, orderId } = await codCheckout();

  // The buyer's receipt, open on the stream with its receipt nonce.
  const receipt = await openStream('receipt', {
    capabilities: [checkout.capability.nonce],
    topics: [`record:product-order:${orderId}`],
  });
  expect(receipt.status).toBe(200);

  const early = await dispatch(orderId, bearer);
  expect(early.status).toBe(409);
  expect(((await early.json()) as { code: string }).code).toBe('guideMissing');

  expect((await recordGuide(orderId, bearer, 'G-LIVE-1')).status).toBe(200);
  const accepted = await dispatch(orderId, bearer);
  expect(accepted.status).toBe(202);
  const flowId = ((await accepted.json()) as { data: { flowId: string } }).data
    .flowId;
  await settled(flowId, { bearer }, { orWaiting: true });

  const orders = (await mongo('order')).collection('product-order');
  const shipped = await eventually(
    () => orders.findOne({ id: orderId }),
    order => order?.['status'] === 'dispatched',
    { timeoutMs: 30_000, what: 'the order to be marked dispatched' },
  );
  expect(shipped).toMatchObject({
    courierName: 'Mensajería del barrio',
    trackingNumber: 'G-LIVE-1',
  });
  expect(
    await receipt.until(
      () =>
        payloads(receipt).some(
          frame =>
            JSON.stringify(frame.body).includes(orderId) &&
            JSON.stringify(frame.body).includes('product-order'),
        ),
      15_000,
    ),
  ).toBe(true);

  // The lab's courier reports the delivery after its dial.
  const delaySeconds = Number(
    await configValue(
      'fulfilment-service',
      'fulfilment',
      'courierSimulatorDelaySeconds',
    ),
  );
  expect(delaySeconds).toBeGreaterThan(0);
  const delivered = await eventually(
    () => orders.findOne({ id: orderId }),
    order => order?.['status'] === 'fulfilled',
    {
      timeoutMs: (delaySeconds + 90) * 1000,
      what: 'the simulated courier to deliver the parcel',
    },
  );
  expect(delivered?.['fulfilledAt']).toBeInstanceOf(Date);
  const frames = payloads(receipt).filter(frame =>
    JSON.stringify(frame.body).includes(orderId),
  );
  expect(frames.length).toBeGreaterThanOrEqual(2);
  receipt.close();
}, 400_000);

it('leaves the order with the guide its shipment left with when relabel and dispatch race', async () => {
  const bearer = await vendorBearer(DEMO.organizationId);
  const ORDERS = Number(process.env['LIVE_RACE_ORDERS'] ?? 6);
  const placed: string[] = [];
  for (let n = 0; n < ORDERS; n++) {
    const { orderId } = await codCheckout();
    expect(
      (await recordGuide(orderId, bearer, `G-A-${String(n)}`)).status,
    ).toBe(200);
    placed.push(orderId);
  }

  const answers = await Promise.all(
    placed.flatMap((orderId, n) => [
      recordGuide(orderId, bearer, `G-B-${String(n)}`).then(res => ({
        verb: 'relabel',
        status: res.status,
      })),
      dispatch(orderId, bearer).then(async res => ({
        verb: 'dispatch',
        status: res.status,
        flowId:
          res.status === 202
            ? ((await res.json()) as { data: { flowId: string } }).data.flowId
            : undefined,
      })),
    ]),
  );
  await Promise.all(
    answers
      .flatMap(answer =>
        'flowId' in answer && typeof answer.flowId === 'string'
          ? [answer.flowId]
          : [],
      )
      .map(flowId => settled(flowId, { bearer }, { orWaiting: true })),
  );

  const shipments = (
    await mongo(`fulfilment_${DEMO.organizationId}`)
  ).collection('shipping-order');
  const orders = (await mongo('order')).collection('product-order');
  for (const orderId of placed) {
    const order = await eventually(
      () => orders.findOne({ id: orderId }),
      found => found?.['status'] === 'dispatched',
      { timeoutMs: 30_000, what: `order ${orderId} dispatched` },
    );
    const shipment = await shipments.findOne({ id: orderId });
    // Whichever relabel landed, the order carries exactly the shipment's guide.
    expect(order?.['trackingNumber'], orderId).toBe(
      shipment?.['trackingNumber'],
    );
  }
  console.info(
    'relabel vs dispatch',
    JSON.stringify(
      answers.map(answer => `${answer.verb}:${String(answer.status)}`),
    ),
  );
}, 400_000);
