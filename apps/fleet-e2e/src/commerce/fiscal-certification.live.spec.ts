import {
  closeMongo,
  DEMO,
  eventually,
  FLEET,
  mongo,
  ordersOf,
  sellable,
  settled,
  startCheckout,
  vendorBearer,
} from '../support/lab';

/**
 * The FEL document a paid order is certified with, and the annulment of one
 * cancelled after it (ADR 0078 §6, #668). order-service's sweep reads the
 * order's status rather than hearing each payment event, so a card order is
 * certified with no message of its own; the buyer reads the document on the
 * receipt; and a vendor's cancellation of a certified order is followed by an
 * annulment, while the order's money moves exactly as it did before — a
 * certifier is never on a payment's path.
 */
const ORDERS = Number(process.env['LIVE_FISCAL_ORDERS'] ?? 6);

afterAll(closeMongo);

it(`certifies every paid order once, and voids the ones cancelled after, ${String(ORDERS)} orders over`, async () => {
  const offering = await sellable(DEMO.organizationId, ORDERS);
  const bearer = await vendorBearer(DEMO.organizationId);
  const orders = (await mongo('order')).collection('product-order');

  const placed = await Promise.all(
    Array.from({ length: ORDERS }, async () => {
      const checkout = await startCheckout([
        {
          vendorId: DEMO.organizationId,
          paymentMethod: 'card',
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
      const [order] = await ordersOf(checkout.flowId);
      return {
        orderId: String(order?.['id']),
        groupId: checkout.flowId,
        nonce: checkout.capability.nonce,
      };
    }),
  );
  const ids = placed.map(p => p.orderId);

  const certified = await eventually(
    () => orders.find({ id: { $in: ids } }).toArray(),
    rows => rows.every(row => typeof row['fiscalAuthorization'] === 'string'),
    { timeoutMs: 45_000, what: 'every order certified' },
  );
  for (const row of certified) {
    // Certifying moved nothing: the order stands where checkout left it.
    expect(['paid', 'confirmed']).toContain(row['status']);
    expect(row['fiscalDocumentType']).toBe(
      row['sellerTaxRegime'] === 'small-taxpayer' ? 'FPEQ' : 'FACT',
    );
    expect(row['fiscalFailure']).toBeUndefined();
  }
  // One document per order: distinct authorizations, no two alike.
  expect(
    new Set(certified.map(row => String(row['fiscalAuthorization']))).size,
  ).toBe(ORDERS);

  // The buyer reads it on the receipt, with their capability alone.
  const [first] = placed;
  const receipt = (await (
    await fetch(
      `${FLEET.order}/api/checkout-group/${first?.groupId}/buyer-receipt`,
      { headers: { 'x-cancel-nonce': String(first?.nonce) } },
    )
  ).json()) as { orders: { data: Record<string, unknown> }[] };
  expect(receipt.orders[0]?.data['fiscalAuthorization']).toBe(
    certified.find(row => row['id'] === first?.orderId)?.[
      'fiscalAuthorization'
    ],
  );

  // Half are cancelled by the vendor, at once; each is annulled after.
  const cancelled = ids.slice(0, Math.ceil(ORDERS / 2));
  const answers = await Promise.all(
    cancelled.map(orderId =>
      fetch(`${FLEET.order}/api/product-order/${orderId}/cancel`, {
        method: 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: '{}',
      }).then(res => res.status),
    ),
  );
  expect(
    answers.every(status => status < 300),
    String(answers),
  ).toBe(true);

  const voided = await eventually(
    () => orders.find({ id: { $in: cancelled } }).toArray(),
    rows =>
      rows.every(
        row =>
          row['status'] === 'cancelled' &&
          typeof row['fiscalVoidAuthorization'] === 'string',
      ),
    { timeoutMs: 90_000, what: 'every cancelled order voided' },
  );
  for (const row of voided) {
    expect(row['fiscalVoidAuthorization']).not.toBe(row['fiscalAuthorization']);
  }
  // The rest keep their document and are never voided.
  const kept = await orders
    .find({ id: { $in: ids.slice(cancelled.length) } })
    .toArray();
  for (const row of kept) {
    expect(row['fiscalVoidedAt']).toBeUndefined();
  }
});
