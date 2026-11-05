import { randomUUID } from 'node:crypto';

import {
  closeMongo,
  crossingHeaders,
  DEMO,
  FLEET,
  mongo,
  ordersOf,
  sellable,
  settled,
  startCheckout,
} from '../support/lab';

/**
 * Twenty partial refunds against one paid order, at once, each its own command
 * (ADR 0058, ADR 0069). The allocation's guarded `$inc` —
 * `refunded + amount <= captured`, taken before the provider is called — is the
 * only thing standing between that burst and money given back twice, and only
 * a burst can tell a guarded increment from a read-then-write.
 */
const REFUNDS = 20;

afterAll(closeMongo);

it('never refunds more than was captured, however many refunds race', async () => {
  const offering = await sellable(DEMO.organizationId, 2);
  const quantity = 2;

  const checkout = await startCheckout([
    {
      vendorId: DEMO.organizationId,
      paymentMethod: 'card',
      lines: [
        {
          offeringId: offering.offeringId,
          quantity,
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
  const orderId = String(order?.['id']);
  const captured = offering.amount * quantity;
  // Eight of these would empty the share; twenty are fired.
  const slice = Math.ceil(captured / 8);

  const headers = () => crossingHeaders('payment-service', randomUUID());
  const answers = await Promise.all(
    Array.from({ length: REFUNDS }, async () => {
      const res = await fetch(`${FLEET.payment}/api/refund`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ orderId, amount: slice }),
      });
      return { status: res.status, body: (await res.json()) as unknown };
    }),
  );

  const allocation = await (
    await mongo('payment')
  )
    .collection('payment-allocation')
    .findOne({ orderId });
  const refunds = await (
    await mongo('payment')
  )
    .collection('refund')
    .find({ orderId })
    .toArray();
  const refundedTotal = refunds
    .filter(refund => refund['status'] !== 'declined')
    .reduce((sum, refund) => sum + Number(refund['amount']), 0);
  const accepted = answers.filter(
    answer => answer.status >= 200 && answer.status < 300,
  );

  console.info(
    'refund burst',
    JSON.stringify({
      captured,
      slice,
      refunded: allocation?.['refunded'],
      accepted: accepted.length,
      refused: answers
        .filter(answer => answer.status >= 300)
        .map(answer => answer.status),
      firstRefusal: answers.find(answer => answer.status >= 300)?.body,
    }),
  );
  expect(Number(allocation?.['captured'])).toBe(captured);
  expect(Number(allocation?.['refunded'])).toBeLessThanOrEqual(captured);
  // The counter, the records and the answers tell one story.
  expect(Number(allocation?.['refunded'])).toBe(refundedTotal);
  expect(accepted.length * slice).toBe(refundedTotal);
  // And the guard did not over-refuse: everything that fitted went through.
  expect(captured - refundedTotal).toBeLessThan(slice);
});
