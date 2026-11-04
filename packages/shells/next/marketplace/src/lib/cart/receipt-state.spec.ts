import { describe, expect, it } from 'vitest';

import {
  parseReceipt,
  type Receipt,
  RECEIPT_LINE_CAP,
  receiptFromReadBack,
  serializeReceipt,
  withCancelled,
} from './receipt-state.js';

const line = (offeringId = 'o-1', quantity = 2, amount = 100) => ({
  offeringId,
  quantity,
  amount,
  currency: 'GTQ',
});

const receipt: Receipt = {
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

  it('keeps a receipt whose cancel window was never stamped', () => {
    const { cancelWindowEndsAt: _, ...unstamped } = receipt;
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
          items: [line('o-1', 2, 100)],
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
