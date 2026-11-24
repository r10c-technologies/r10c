import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  closeMongo,
  configValue,
  FLEET,
  HARDWARE,
  mongo,
  ordersOf,
  sellable,
  settled,
  startCheckout,
} from '../support/lab';

/**
 * A buyer attaches a payment receipt while the same order is withdrawn
 * (ADR 0081 §6, #691). The attach writes its bytes first, then appends on
 * `awaiting-payment`; the withdrawal is one conditional write on the same
 * status. So the order ends withdrawn either way, and the file store has to
 * agree with the record: an attach that lost deletes its bytes in the same
 * request, and one that won is listed on the order it was attached to.
 *
 * A sequential pass proves none of that, which is why this is a burst.
 */
const ORDERS = Number(process.env['LIVE_RACE_ORDERS'] ?? 10);

/** A 1×1 PNG: the service sniffs the bytes, not the declared type. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ROOT = path.resolve(import.meta.dirname, '../../../..');

afterAll(closeMongo);

/** The receipts on disk under one order's key, by object key. */
const storedFor = async (directory: string, orderId: string) => {
  const dir = path.join(directory, 'data', 'evidence', orderId);
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.map(name => `evidence/${orderId}/${name}`).sort();
};

it(`keeps the file store and the record in step when attach races withdraw, ${String(ORDERS)} orders over`, async () => {
  const offering = await sellable(HARDWARE.organizationId, ORDERS);
  const directory = path.resolve(
    ROOT,
    await configValue('order-service', 'payment-evidence', 'directory'),
  );

  const placed: { orderId: string; flowId: string; nonce: string }[] = [];
  for (let n = 0; n < ORDERS; n++) {
    const checkout = await startCheckout([
      {
        vendorId: HARDWARE.organizationId,
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
    placed.push({
      orderId: String(order?.['id']),
      flowId: checkout.flowId,
      nonce: checkout.capability.nonce,
    });
  }

  // Both, on every order, at once.
  const answers = await Promise.all(
    placed.flatMap(({ orderId, nonce }) => [
      fetch(
        `${FLEET.order}/api/product-order/${orderId}/buyer-payment-evidence`,
        {
          method: 'POST',
          headers: { 'content-type': 'image/png', 'x-cancel-nonce': nonce },
          body: PNG,
        },
      ).then(async res => ({
        orderId,
        verb: 'attach',
        status: res.status,
        code: res.ok
          ? undefined
          : ((await res.json()) as { code?: string }).code,
      })),
      fetch(`${FLEET.order}/api/product-order/${orderId}/buyer-cancellation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancelNonce: nonce }),
      }).then(res => ({
        orderId,
        verb: 'withdraw',
        status: res.status,
        code: undefined,
      })),
    ]),
  );

  // A withdrawal always lands: an attach does not move the status.
  for (const answer of answers.filter(a => a.verb === 'withdraw')) {
    expect(answer.status, JSON.stringify(answer)).toBeLessThan(300);
  }
  // An attach either won, or lost to the withdrawal and says so.
  for (const answer of answers.filter(a => a.verb === 'attach')) {
    expect(
      answer.status === 200 ||
        (answer.status === 409 && answer.code === 'orderNotAwaitingPayment'),
      JSON.stringify(answer),
    ).toBe(true);
  }

  const ends = await Promise.all(
    placed.map(({ flowId, nonce }) =>
      settled(flowId, { capability: { nonce, digest: '' } }),
    ),
  );
  expect(ends.map(end => end.state)).toEqual(placed.map(() => 'completed'));

  const orders = (await mongo('order')).collection('product-order');
  for (const { orderId } of placed) {
    const order = await orders.findOne({ id: orderId });
    expect(order?.['status']).toBe('cancelled');
    const listed = (
      (order?.['paymentEvidence'] ?? []) as { objectKey?: string }[]
    )
      .flatMap(entry => (entry.objectKey === undefined ? [] : [entry.objectKey]))
      .sort();
    const won = answers.some(
      a => a.orderId === orderId && a.verb === 'attach' && a.status === 200,
    );
    // The record lists the receipt only when the attach won, and the store
    // holds exactly what the record lists: no orphan, no dangling key.
    expect({ orderId, listed: listed.length }).toEqual({
      orderId,
      listed: won ? 1 : 0,
    });
    expect(await storedFor(directory, orderId)).toEqual(listed);
  }
}, 600_000);
