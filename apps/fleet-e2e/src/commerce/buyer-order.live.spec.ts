import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  closeMongo,
  configValue,
  eventually,
  FLEET,
  HARDWARE,
  mongo,
  ordersOf,
  recordGuide,
  sellable,
  settled,
  sleep,
  startCheckout,
  vendorBearer,
} from '../support/lab';
import { MAILBOX, mailsFor, mailText } from '../support/mail';

/**
 * The buyer's order, from the review to the door and back (#590, ADR 0076):
 * a storefront checkout with a contact and a destination, cash on delivery;
 * the receipt mail and its one-time link; the vendor's worklist naming the
 * order and where it goes; the dispatch and the delivery. Around it, the
 * claims only a live fleet can make: no personal key crosses the bus, a link
 * redeems once however many browsers race it, and "find my order" mails at
 * most once per interval however often it is asked.
 */
const RABBIT = process.env['RABBITMQ_API_URL'] ?? 'http://localhost:31672';
const RABBIT_AUTH = `Basic ${Buffer.from(
  process.env['RABBITMQ_API_CREDENTIALS'] ?? 'admin:password',
).toString('base64')}`;
const EXCHANGE = 'entifix.events';
const BURST = Number(process.env['LIVE_BURST'] ?? 8);

/** What the buyer typed, as `startCheckout` states it. */
const PERSONAL_VALUES = [
  'Ana López',
  '+50255551234',
  '55551234',
  'ana@correo.com',
  '5a avenida 12-34',
];
const PERSONAL_KEYS = [
  'contact',
  'destination',
  'email',
  'phone',
  'addressLine',
];

const rabbit = (path: string, init: RequestInit = {}) =>
  fetch(`${RABBIT}/api${path}`, {
    ...init,
    headers: {
      authorization: RABBIT_AUTH,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

const tokenIn = (text: string) => /[?&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1];

const redeem = (token: string) => {
  const nonce = randomBytes(32).toString('hex');
  return fetch(`${FLEET.order}/api/checkout-group/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      capabilityDigest: createHash('sha256')
        .update(nonce, 'utf8')
        .digest('hex'),
    }),
  });
};

const queue = `fleet-e2e-personal-keys-${randomUUID()}`;

beforeAll(async () => {
  // A queue of our own on every order and shipment event, so the snapshot
  // reads what the bus carried without taking a message from any consumer.
  expect(
    (
      await rabbit(`/queues/%2F/${queue}`, {
        method: 'PUT',
        body: JSON.stringify({ durable: true, auto_delete: false }),
      })
    ).status,
  ).toBeLessThan(300);
  for (const key of ['order.#', 'shipping-order.#', 'checkout-group.#']) {
    expect(
      (
        await rabbit(`/bindings/%2F/e/${EXCHANGE}/q/${queue}`, {
          method: 'POST',
          body: JSON.stringify({ routing_key: key }),
        })
      ).status,
    ).toBeLessThan(300);
  }
});

afterAll(async () => {
  await rabbit(`/queues/%2F/${queue}`, { method: 'DELETE' });
  await closeMongo();
});

// The journey turns on the receipt mail's link, so it needs a mailbox to read.
it.runIf(MAILBOX !== undefined)(
  'takes a buyer from the review to the door, and keeps their data off the bus',
  async () => {
    const bearer = await vendorBearer(HARDWARE.organizationId);
    const offering = await sellable(HARDWARE.organizationId, 1);
    const checkout = await startCheckout([
      {
        vendorId: HARDWARE.organizationId,
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
    expect(checkout.status, JSON.stringify(checkout.problem)).toBe(202);
    expect(
      (await settled(checkout.flowId, { capability: checkout.capability }))
        .state,
    ).toBe('completed');
    const groups = (await mongo('order')).collection('checkout-group');
    const group = await groups.findOne({ id: checkout.flowId });
    const number = String(group?.['number']);
    const [order] = await ordersOf(checkout.flowId);
    const orderId = String(order?.['id']);

    // The receipt mail, with a link that opens the order elsewhere.
    const [mail] = await eventually(
      () => mailsFor(number),
      found => found.length > 0,
      { timeoutMs: 60_000, what: `the receipt mail for ${number}` },
    );
    const token = tokenIn(await mailText(String(mail?.ID)));
    expect(token, 'the receipt mail carries an access link').toBeDefined();

    // Many browsers race one link: exactly one redeems it.
    const redemptions = await Promise.all(
      Array.from({ length: BURST }, () => redeem(String(token))),
    );
    const statuses = redemptions.map(res => res.status);
    expect(statuses.filter(status => status === 200)).toHaveLength(1);
    expect(statuses.filter(status => status !== 200)).toEqual(
      Array.from({ length: BURST - 1 }, () => 401),
    );

    // The vendor's worklist names the order and where it goes.
    const shipment = (await (
      await fetch(`${FLEET.fulfilment}/api/shipping-order/${orderId}`, {
        headers: { authorization: bearer },
      })
    ).json()) as { data?: Record<string, unknown> };
    expect(shipment.data?.['orderNumber']).toEqual(expect.any(String));
    expect(JSON.stringify(shipment.data?.['destination'])).toContain(
      '5a avenida 12-34',
    );

    // Dispatched with its guide, and delivered by the lab's courier.
    expect((await recordGuide(orderId, bearer)).status).toBe(200);
    const dispatched = await fetch(
      `${FLEET.fulfilment}/api/shipping-order/${orderId}/dispatch`,
      {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(dispatched.status).toBe(202);
    const delaySeconds = Number(
      await configValue(
        'fulfilment-service',
        'fulfilment',
        'courierSimulatorDelaySeconds',
      ),
    );
    const orders = (await mongo('order')).collection('product-order');
    await eventually(
      () => orders.findOne({ id: orderId }),
      row => row?.['status'] === 'fulfilled',
      {
        timeoutMs: (delaySeconds + 120) * 1000,
        what: 'the parcel to be delivered',
      },
    );

    // "Find my order", asked many times at once with the interval elapsed:
    // one mail goes out.
    await groups.updateOne(
      { id: checkout.flowId },
      { $set: { accessSentAt: new Date(Date.now() - 24 * 3600 * 1000) } },
    );
    const before = (await mailsFor(number)).length;
    const lookupToken = await configValue(
      'order-service',
      'service',
      'storefrontToken',
    );
    const lookups = await Promise.all(
      Array.from({ length: BURST }, () =>
        fetch(`${FLEET.order}/api/checkout-group/send-access-link`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-crossing-token': lookupToken,
          },
          body: JSON.stringify({ number, email: 'ana@correo.com' }),
        }),
      ),
    );
    expect(lookups.map(res => res.status)).toEqual(
      Array.from({ length: BURST }, () => 202),
    );
    await eventually(
      async () => (await mailsFor(number)).length,
      count => count > before,
      { timeoutMs: 30_000, what: 'the lookup mail' },
    );
    // Long enough for a second mail to land, were one sent.
    await sleep(5_000);
    expect((await mailsFor(number)).length).toBe(before + 1);

    // What the bus carried about this order: nothing the buyer typed.
    const messages = (await (
      await rabbit(`/queues/%2F/${queue}/get`, {
        method: 'POST',
        body: JSON.stringify({
          count: 1000,
          ackmode: 'ack_requeue_false',
          encoding: 'auto',
        }),
      })
    ).json()) as { routing_key: string; payload: string }[];
    const ours = messages.filter(
      message =>
        message.payload.includes(orderId) ||
        message.payload.includes(checkout.flowId),
    );
    expect(ours.length, 'the snapshot saw this order’s events').toBeGreaterThan(
      0,
    );
    for (const message of ours) {
      for (const value of PERSONAL_VALUES) {
        expect(message.payload, message.routing_key).not.toContain(value);
      }
      for (const key of PERSONAL_KEYS) {
        expect(message.payload, message.routing_key).not.toContain(`"${key}"`);
      }
    }
  },
  600_000,
);
