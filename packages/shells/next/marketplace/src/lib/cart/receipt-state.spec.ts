import { describe, expect, it } from 'vitest';

import {
  lineNameKey,
  parseReceipt,
  type Receipt,
  RECEIPT_LINE_CAP,
  receiptCookieMaxAge,
  receiptDetailsOf,
  receiptFromReadBack,
  serializeReceipt,
  trackerSteps,
  withCancelled,
} from './receipt-state.js';

/** A line as the receipt keeps it: its unit, how many, and what it cost. */
const line = (offeringId = 'o-1', quantity = 2, lineTotal = 200) => ({
  offeringId,
  unit: 'UN' as const,
  quantity,
  lineTotal,
  currency: 'GTQ',
});

const receipt: Receipt = {
  number: '7KQ4-M2XD',
  groupId: 'g-1',
  placedAt: '2026-11-03T10:00:00.000Z',
  orders: [
    {
      orderId: 'o-a',
      vendorId: 'v-1',
      vendorName: 'Tienda Uno',
      method: 'card',
      lines: [line()],
      lineCount: 1,
      total: { currency: 'GTQ', amount: 200 },
    },
    {
      orderId: 'o-b',
      vendorId: 'v-2',
      method: 'cod',
      lineCount: 13,
      total: { currency: 'GTQ', amount: 50 },
    },
  ],
  totals: [{ currency: 'GTQ', amount: 250 }],
  cancelNonce: 'nonce',
  cancelWindowEndsAt: '2026-11-03T10:30:00.000Z',
  receiptEndsAt: '2026-12-03T10:00:00.000Z',
};

describe('the group receipt', () => {
  it('round-trips through its cookie', () => {
    expect(parseReceipt(serializeReceipt(receipt))).toEqual(receipt);
  });

  it('refuses a forged or broken cookie rather than rendering a receipt that lies', () => {
    const forged = (patch: Record<string, unknown>) =>
      parseReceipt(JSON.stringify({ ...receipt, ...patch }));

    expect(parseReceipt(undefined)).toBeUndefined();
    expect(parseReceipt('not json')).toBeUndefined();
    expect(parseReceipt('7')).toBeUndefined();
    expect(forged({ groupId: '' })).toBeUndefined();
    expect(forged({ orders: [] })).toBeUndefined();
    expect(forged({ orders: 'many' })).toBeUndefined();
    expect(forged({ orders: [{ orderId: 'x' }] })).toBeUndefined();
    expect(forged({ orders: [7] })).toBeUndefined();
    expect(
      forged({
        orders: [{ ...receipt.orders[0], total: { currency: 'GTQ' } }],
      }),
    ).toBeUndefined();
    expect(
      forged({ orders: [{ ...receipt.orders[0], lineCount: 'one' }] }),
    ).toBeUndefined();
    expect(forged({ totals: [7] })).toBeUndefined();
    expect(forged({ totals: 'none' })).toBeUndefined();
  });

  it('keeps only true as cancelled, and drops what it cannot read', () => {
    const parsed = parseReceipt(
      JSON.stringify({
        ...receipt,
        placedAt: 7,
        cancelNonce: '',
        orders: [
          {
            ...receipt.orders[0],
            cancelled: 'yes',
            vendorName: '',
            lines: [line(), { offeringId: 'broken' }, 7],
          },
        ],
      }),
    );

    expect(parsed?.orders[0]?.cancelled).toBeUndefined();
    expect(parsed?.orders[0]?.vendorName).toBeUndefined();
    expect(parsed?.orders[0]?.lines).toEqual([line()]);
    expect(parsed?.placedAt).toBeUndefined();
    expect(parsed?.cancelNonce).toBeUndefined();
  });

  it('keeps a receipt whose windows were never stamped', () => {
    const {
      cancelWindowEndsAt: _window,
      receiptEndsAt: _ends,
      ...unstamped
    } = receipt;
    expect(parseReceipt(serializeReceipt(unstamped))).toEqual(unstamped);
  });

  it('marks one vendor order cancelled and leaves the rest', () => {
    const after = withCancelled(receipt, 'o-a');

    expect(after.orders.map(order => order.cancelled)).toEqual([
      true,
      undefined,
    ]);
    expect(parseReceipt(serializeReceipt(after))?.orders[0]?.cancelled).toBe(
      true,
    );
  });
});

describe('receiptFromReadBack', () => {
  const envelope = (data: Record<string, unknown>) => ({ data });
  const readBack = (orders: unknown[] = []) => ({
    group: envelope({
      id: 'g-1',
      placedAt: '2026-11-03T10:00:00.000Z',
      cancelWindowEndsAt: '2026-11-03T10:30:00.000Z',
      receiptEndsAt: '2026-12-03T10:00:00.000Z',
    }),
    orders,
  });
  const names = new Map([['v-1', 'Tienda Uno']]);

  it('builds the receipt from the group and its vendor orders, naming each seller', () => {
    const built = receiptFromReadBack(
      readBack([
        envelope({
          id: 'o-a',
          vendorId: 'v-1',
          paymentMethod: 'cod',
          items: [line('o-1', 2, 200)],
        }),
        envelope({
          id: 'o-b',
          vendorId: 'v-2',
          items: Array.from({ length: RECEIPT_LINE_CAP + 1 }, () => line()),
        }),
      ]),
      'nonce',
      names,
    );

    expect(built).toMatchObject({
      groupId: 'g-1',
      placedAt: '2026-11-03T10:00:00.000Z',
      cancelNonce: 'nonce',
      cancelWindowEndsAt: '2026-11-03T10:30:00.000Z',
      receiptEndsAt: '2026-12-03T10:00:00.000Z',
      totals: [{ currency: 'GTQ', amount: 2800 }],
    });
    expect(built?.orders[0]).toMatchObject({
      vendorName: 'Tienda Uno',
      method: 'cod',
      lineCount: 1,
    });
    expect(built?.orders[1]).toMatchObject({ method: 'card', lineCount: 13 });
    expect(built?.orders[1]?.lines).toBeUndefined();
    expect(built?.orders[1]?.vendorName).toBeUndefined();
  });

  it('refuses an answer that is not a group with its orders', () => {
    expect(receiptFromReadBack(undefined, 'n', names)).toBeUndefined();
    expect(
      receiptFromReadBack({ group: 7, orders: [] }, 'n', names),
    ).toBeUndefined();
    expect(receiptFromReadBack(readBack([]), 'n', names)).toBeUndefined();
    expect(
      receiptFromReadBack(readBack([envelope({ id: 'o' })]), 'n', names),
    ).toBeUndefined();
    expect(
      receiptFromReadBack(
        readBack([envelope({ id: 'o', vendorId: 'v', items: [] })]),
        'n',
        names,
      ),
    ).toBeUndefined();
    expect(receiptFromReadBack(readBack([7]), 'n', names)).toBeUndefined();
    expect(
      receiptFromReadBack(
        readBack([envelope({ id: 'o', vendorId: '', items: [line()] })]),
        'n',
        names,
      ),
    ).toBeUndefined();
    expect(
      receiptFromReadBack(
        readBack([envelope({ id: 'o', vendorId: 'v', items: 'none' })]),
        'n',
        names,
      ),
    ).toBeUndefined();
  });

  it('omits the times a group did not stamp', () => {
    const built = receiptFromReadBack(
      {
        group: envelope({ id: 'g-1' }),
        orders: [envelope({ id: 'o', vendorId: 'v-1', items: [line()] })],
      },
      'n',
      names,
    );

    expect(built?.placedAt).toBeUndefined();
    expect(built?.cancelWindowEndsAt).toBeUndefined();
  });
});

describe('receiptCookieMaxAge', () => {
  const NOW = new Date('2026-11-03T10:00:00.000Z');

  it('lives until the group’s own receiptEndsAt, past the cancel window', () => {
    // 30 days, though the cancel window closed after 30 minutes.
    expect(receiptCookieMaxAge(receipt, NOW)).toBe(30 * 24 * 60 * 60);
  });

  it('is nought with no stamp, a broken one, or one already past', () => {
    const { receiptEndsAt: _, ...unstamped } = receipt;
    expect(receiptCookieMaxAge(unstamped, NOW)).toBe(0);
    expect(
      receiptCookieMaxAge({ ...receipt, receiptEndsAt: 'nope' }, NOW),
    ).toBe(0);
    expect(
      receiptCookieMaxAge(
        { ...receipt, receiptEndsAt: '2026-11-03T09:00:00.000Z' },
        NOW,
      ),
    ).toBe(0);
  });
});

describe('the receipt’s numbers (ADR 0076 §5)', () => {
  it('keeps the purchase’s number and each seller’s, and drops a blank one', () => {
    const numbered: Receipt = {
      ...receipt,
      number: '7KQ4-M2XD',
      orders: receipt.orders.map((order, index) =>
        index === 0 ? { ...order, number: 'Q3AW-37H5' } : order,
      ),
    };

    expect(parseReceipt(serializeReceipt(numbered))).toEqual(numbered);
    expect(
      parseReceipt(JSON.stringify({ ...numbered, number: '' }))?.number,
    ).toBeUndefined();
  });

  it('reads them off the group and its orders as order-service answers them', () => {
    const built = receiptFromReadBack(
      {
        group: { data: { id: 'g-1', number: '7KQ4-M2XD' } },
        orders: [
          {
            data: {
              id: 'o-a',
              number: 'Q3AW-37H5',
              vendorId: 'v-1',
              items: [line('o-1', 1, 100)],
            },
          },
        ],
      },
      'nonce',
      new Map(),
    );

    expect(built?.number).toBe('7KQ4-M2XD');
    expect(built?.orders[0]?.number).toBe('Q3AW-37H5');
  });
});

describe('receiptDetailsOf, for a payment-link order', () => {
  const read = (orders: unknown[]) =>
    receiptDetailsOf({ group: { data: { id: 'g-1' } }, orders });

  it('reads a waiting order’s due time and the seller’s link', () => {
    const details = read([
      {
        data: {
          id: 'o-1',
          paymentMethod: 'link',
          status: 'awaiting-payment',
          paymentDueAt: '2026-11-21T10:00:00.000Z',
          paymentLinkUrl: 'https://pay.example/p/1',
          paymentLinkProviderKey: 'other',
          paymentLinkProviderName: 'Mi banco',
        },
      },
      { data: { id: 'o-2', paymentMethod: 'card', status: 'paid' } },
    ]);

    expect(details?.payments.get('o-1')).toEqual({
      awaiting: true,
      dueAt: '2026-11-21T10:00:00.000Z',
      expired: false,
      evidence: [],
      link: {
        url: 'https://pay.example/p/1',
        host: 'pay.example',
        providerName: 'Mi banco',
        unlisted: true,
      },
    });
    expect(details?.payments.has('o-2')).toBe(false);
  });

  it('reads a waiting order whose seller set no link yet', () => {
    const details = read([
      {
        data: { id: 'o-1', paymentMethod: 'link', status: 'awaiting-payment' },
      },
    ]);

    expect(details?.payments.get('o-1')).toEqual({
      awaiting: true,
      expired: false,
      evidence: [],
    });
  });

  it.each(['http://pay.example/p', 'not a url'])(
    'shows no link that is not https: %s',
    url => {
      const details = read([
        {
          data: {
            id: 'o-1',
            paymentMethod: 'link',
            status: 'awaiting-payment',
            paymentLinkUrl: url,
          },
        },
      ]);

      expect(details?.payments.get('o-1')).toEqual({
        awaiting: true,
        expired: false,
        evidence: [],
      });
    },
  );

  it('lists the receipts whose file is kept, as an image or a PDF', () => {
    const details = read([
      {
        data: {
          id: 'o-1',
          paymentMethod: 'link',
          status: 'awaiting-payment',
          paymentEvidence: [
            {
              id: 'e-1',
              objectKey: 'evidence/o-1/e-1',
              contentType: 'image/png',
            },
            {
              id: 'e-2',
              objectKey: 'evidence/o-1/e-2',
              contentType: 'application/pdf',
            },
            { id: 'e-3', contentType: 'image/png', redactedAt: '2026-01-01' },
          ],
        },
      },
    ]);

    expect(details?.payments.get('o-1')?.evidence).toEqual([
      { id: 'e-1', kind: 'image' },
      { id: 'e-2', kind: 'pdf' },
    ]);
  });

  it('names an unnamed provider by its host, and reads an expired order', () => {
    const details = read([
      {
        data: {
          id: 'o-1',
          paymentMethod: 'link',
          status: 'cancelled',
          cancelCause: 'payment-expired',
          paymentLinkUrl: 'https://pay.acq.example/1',
          paymentLinkProviderKey: 'acq',
        },
      },
    ]);

    expect(details?.payments.get('o-1')).toMatchObject({
      awaiting: false,
      expired: true,
      link: { providerName: 'pay.acq.example', unlisted: false },
    });
  });
});

describe('receiptDetailsOf', () => {
  const readBack = (contact: unknown, items: unknown[]) => ({
    group: { data: { id: 'g-1', contact } },
    orders: [{ data: { id: 'o-a', items } }, { data: {} }, 'junk'],
  });
  const CONTACT = {
    name: 'Ana López',
    phone: '+50255551234',
    email: 'ana@correo.com',
    departamento: '01',
    municipio: '0108',
    zona: 4,
    addressLine: '5a avenida 12-34',
    reference: 'portón negro',
  };

  it('reads where it goes with the phone cut to its last four, and each line’s stored name', () => {
    const details = receiptDetailsOf(
      readBack(
        [CONTACT],
        [
          { offeringId: 'o-1', name: 'Lámpara Aurora' },
          { offeringId: 'o-2' },
          'junk',
        ],
      ),
    );

    expect(details?.delivery).toEqual({
      name: 'Ana López',
      phoneEnding: '1234',
      departamento: '01',
      municipio: '0108',
      zona: 4,
      addressLine: '5a avenida 12-34',
      reference: 'portón negro',
    });
    // The email never reaches the page.
    expect(JSON.stringify(details?.delivery)).not.toContain('correo');
    expect(details?.lineNames.get(lineNameKey('o-a', 'o-1'))).toBe(
      'Lámpara Aurora',
    );
    expect(details?.lineNames.size).toBe(1);
  });

  it('has no delivery for a counter sale, a redacted contact or a partial one', () => {
    const { zona: _zona, reference: _reference, ...bare } = CONTACT;
    expect(receiptDetailsOf(readBack([], []))?.delivery).toBeUndefined();
    expect(receiptDetailsOf(readBack(undefined, []))?.delivery).toBeUndefined();
    expect(receiptDetailsOf(readBack(['junk'], []))?.delivery).toBeUndefined();
    expect(
      receiptDetailsOf(readBack([{ ...CONTACT, name: '' }], []))?.delivery,
    ).toBeUndefined();
    expect(receiptDetailsOf(readBack([bare], []))?.delivery).toEqual({
      name: 'Ana López',
      phoneEnding: '1234',
      departamento: '01',
      municipio: '0108',
      addressLine: '5a avenida 12-34',
    });
  });

  it('reads the IVA each order includes, and whom the receipt is billed to', () => {
    const details = receiptDetailsOf({
      group: { data: { id: 'g-1' } },
      orders: [
        {
          data: {
            id: 'o-a',
            sellerTaxRegime: 'general',
            taxAmount: 429,
            buyerTaxIdType: 'nit',
            buyerTaxId: '12345679',
            buyerTaxName: 'Ana López',
          },
        },
        // A pequeño contribuyente's document shows no IVA.
        {
          data: { id: 'o-b', sellerTaxRegime: 'small-taxpayer', taxAmount: 25 },
        },
        { data: { id: 'o-c', taxAmount: 'junk', buyerTaxIdType: 'cf' } },
      ],
    });

    expect([...(details?.ivaIncluded ?? [])]).toEqual([['o-a', 429]]);
    expect(details?.billedTo).toEqual({
      idType: 'nit',
      taxId: '12345679',
      name: 'Ana López',
    });
  });

  it('bills nobody it cannot name, and a consumidor final with blanks', () => {
    const of = (data: Record<string, unknown>) =>
      receiptDetailsOf({
        group: { data: {} },
        orders: [{ data: { id: 'o', ...data } }],
      })?.billedTo;

    expect(of({ buyerTaxIdType: 'passport' })).toBeUndefined();
    expect(of({ buyerTaxIdType: 'cf', buyerTaxId: 7 })).toEqual({
      idType: 'cf',
      taxId: '',
      name: '',
    });
  });

  it('answers nothing for an answer that is not a read-back', () => {
    expect(receiptDetailsOf(undefined)).toBeUndefined();
    expect(receiptDetailsOf({ group: 7, orders: [] })).toBeUndefined();
    expect(receiptDetailsOf({ group: { data: {} } })).toBeUndefined();
    expect(
      receiptDetailsOf({ group: { data: {} }, orders: [{ data: { id: 'o' } }] })
        ?.lineNames.size,
    ).toBe(0);
  });
});

describe('where an order stands', () => {
  const details = (data: Record<string, unknown>) =>
    receiptDetailsOf({
      group: { data: { id: 'g-1' } },
      orders: [{ data: { id: 'o-1', ...data } }],
    })?.tracking.get('o-1');

  it('reads the status, the tender and the guide a dispatched parcel left with', () => {
    expect(
      details({
        status: 'dispatched',
        paymentMethod: 'cod',
        courierName: 'Mensajería',
        trackingNumber: 'G-1',
        trackingUrl: 'https://track.example/G-1',
      }),
    ).toEqual({
      status: 'dispatched',
      method: 'cod',
      courierName: 'Mensajería',
      trackingNumber: 'G-1',
      trackingUrl: 'https://track.example/G-1',
    });
  });

  it('keeps no tracking link that is not https, and reads card without a tender', () => {
    expect(
      details({ status: 'paid', trackingUrl: 'http://track.example/G-1' }),
    ).toEqual({ status: 'paid', method: 'card' });
  });

  it('reads nothing for an order with no status', () => {
    expect(details({})).toBeUndefined();
  });
});

describe('the FEL document an order was certified with', () => {
  const fiscal = (data: Record<string, unknown>) =>
    receiptDetailsOf({
      group: { data: { id: 'g-1' } },
      orders: [{ data: { id: 'o-1', ...data } }],
    })?.fiscal.get('o-1');

  const CERTIFIED = {
    fiscalDocumentType: 'FACT',
    fiscalSeries: 'A1B2C3D4',
    fiscalNumber: '42',
    fiscalAuthorization: 'A1B2C3D4-0000-0000-0000-000000000000',
  };

  it('says a paid order is being certified until the certifier answers', () => {
    expect(fiscal({ status: 'paid' })).toEqual({ state: 'pending' });
    expect(fiscal({ status: 'fulfilled' })).toEqual({ state: 'pending' });
  });

  it('owes nothing for an order not yet paid for, or never paid', () => {
    expect(fiscal({ status: 'awaiting-payment' })).toBeUndefined();
    expect(fiscal({ status: 'cancelled' })).toBeUndefined();
    expect(fiscal({})).toBeUndefined();
  });

  it('reads the document once certified, and says when it was voided', () => {
    expect(fiscal({ status: 'paid', ...CERTIFIED })).toEqual({
      state: 'certified',
      type: 'FACT',
      series: 'A1B2C3D4',
      number: '42',
      authorization: CERTIFIED.fiscalAuthorization,
    });
    expect(
      fiscal({
        status: 'cancelled',
        fiscalAuthorization: 'X',
        fiscalVoidedAt: '2026-11-20T00:00:00.000Z',
      }),
    ).toEqual({ state: 'voided', authorization: 'X' });
  });
});

describe('trackerSteps', () => {
  const states = (status: string, method = 'card') =>
    trackerSteps(status, method).map(step => `${step.key}:${step.state}`);

  it('keeps a card payment under way while pending, never done', () => {
    expect(states('pending')).toEqual([
      'placed:done',
      'payment:current',
      'dispatched:todo',
      'delivered:todo',
    ]);
  });

  it('marks the parcel on its way once dispatched, and every step done once delivered', () => {
    expect(states('dispatched', 'link')).toEqual([
      'placed:done',
      'payment:done',
      'dispatched:done',
      'delivered:current',
    ]);
    expect(states('fulfilled')).toEqual([
      'placed:done',
      'payment:done',
      'dispatched:done',
      'delivered:done',
    ]);
  });

  it('draws no payment step for cash on delivery', () => {
    expect(states('confirmed', 'cod')).toEqual([
      'placed:done',
      'dispatched:current',
      'delivered:todo',
    ]);
  });

  it('draws nothing for an order that left the way to the door', () => {
    expect(trackerSteps('cancelled', 'card')).toEqual([]);
    expect(trackerSteps('cancelling', 'card')).toEqual([]);
  });
});
