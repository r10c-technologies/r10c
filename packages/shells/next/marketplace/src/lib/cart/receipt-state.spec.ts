import { describe, expect, it } from 'vitest';

import {
  parseReceipt,
  RECEIPT_LINE_CAP,
  receiptFromOrder,
  serializeReceipt,
} from './receipt-state';

const line = (offeringId: string, quantity = 1, amount = 1999) => ({
  offeringId,
  quantity,
  amount,
  currency: 'GTQ',
});

describe('building a receipt from an order', () => {
  it('sums the total from the lines it was given', () => {
    const receipt = receiptFromOrder('order-1', '2026-09-09T00:00:00.000Z', [
      line('o-1', 2),
      line('o-2', 1, 500),
    ]);

    expect(receipt.totals).toEqual([
      { currency: 'GTQ', amount: 2 * 1999 + 500 },
    ]);
    expect(receipt.lineCount).toBe(2);
  });

  /**
   * ⚠️ A marketplace's vendors price independently, so one basket can hold a
   * `GTQ` line and a `USD` one. There is no exchange rate in this system, and a
   * single summed figure would state a price nobody was charged.
   */
  it('keeps one total per currency, in first-seen order', () => {
    const receipt = receiptFromOrder('order-1', undefined, [
      { ...line('o-1', 1), currency: 'USD', amount: 500 },
      line('o-2', 2),
      { ...line('o-3', 1), currency: 'USD', amount: 250 },
    ]);

    expect(receipt.totals).toEqual([
      { currency: 'USD', amount: 750 },
      { currency: 'GTQ', amount: 2 * 1999 },
    ]);
  });

  it('carries the lines when they fit', () => {
    const receipt = receiptFromOrder('order-1', undefined, [line('o-1')]);

    expect(receipt.lines).toHaveLength(1);
    // Absent rather than an empty string: a body without one must not become a
    // date the page renders.
    expect(receipt.placedAt).toBeUndefined();
  });

  /**
   * ⚠️ A cookie is 4KB and a basket has no upper bound. Past the cap the receipt
   * keeps its identity and its totals and drops the lines, because a truncated
   * list rendered as the whole order would be a receipt that lies.
   */
  it('drops the lines past the cap, keeping the count and the total', () => {
    const many = Array.from({ length: RECEIPT_LINE_CAP + 1 }, (_, index) =>
      line(`o-${index}`),
    );

    const receipt = receiptFromOrder('order-1', undefined, many);

    expect(receipt.lines).toBeUndefined();
    expect(receipt.lineCount).toBe(RECEIPT_LINE_CAP + 1);
    expect(receipt.totals).toEqual([
      { currency: 'GTQ', amount: (RECEIPT_LINE_CAP + 1) * 1999 },
    ]);
  });

  it('keeps the lines exactly at the cap', () => {
    const exactly = Array.from({ length: RECEIPT_LINE_CAP }, (_, index) =>
      line(`o-${index}`),
    );

    expect(receiptFromOrder('order-1', undefined, exactly).lines).toHaveLength(
      RECEIPT_LINE_CAP,
    );
  });

  it('reports no totals for an order with no lines', () => {
    // Not reachable from a checkout — the action refuses an empty basket — but
    // a crash here would take down a page rendered after a write that
    // succeeded. The parse then refuses it, so no such receipt is ever read
    // back.
    expect(receiptFromOrder('order-1', undefined, []).totals).toEqual([]);
  });
});

describe('reading a receipt back', () => {
  const round = (receipt: ReturnType<typeof receiptFromOrder>) =>
    parseReceipt(serializeReceipt(receipt));

  it('round-trips what it wrote', () => {
    const receipt = receiptFromOrder('order-1', '2026-09-09T00:00:00.000Z', [
      line('o-1', 2),
    ]);

    expect(round(receipt)).toEqual(receipt);
  });

  it('round-trips a receipt whose lines did not fit', () => {
    const many = Array.from({ length: RECEIPT_LINE_CAP + 1 }, (_, index) =>
      line(`o-${index}`),
    );

    expect(
      round(receiptFromOrder('order-1', undefined, many))?.lines,
    ).toBeUndefined();
  });

  it('reads no receipt from an absent cookie', () => {
    expect(parseReceipt(undefined)).toBeUndefined();
    expect(parseReceipt('')).toBeUndefined();
  });

  /**
   * ⚠️ The cookie is `httpOnly`, so a page cannot write it — but the browser's
   * owner can, and every field here is therefore input rather than something
   * this module is entitled to trust.
   */
  it('refuses a value that is not JSON', () => {
    expect(parseReceipt('not json')).toBeUndefined();
  });

  it('refuses JSON that is not an object', () => {
    expect(parseReceipt('"a string"')).toBeUndefined();
    expect(parseReceipt('null')).toBeUndefined();
  });

  const totals = [{ currency: 'GTQ', amount: 1 }];

  it('refuses a receipt naming no order', () => {
    expect(
      parseReceipt(JSON.stringify({ lineCount: 1, totals })),
    ).toBeUndefined();
    expect(
      parseReceipt(JSON.stringify({ orderId: '', lineCount: 1, totals })),
    ).toBeUndefined();
  });

  it('refuses a receipt whose line count is not a number', () => {
    expect(
      parseReceipt(
        JSON.stringify({ orderId: 'order-1', lineCount: 'one', totals }),
      ),
    ).toBeUndefined();
  });

  it('refuses a receipt that cannot say what the order came to', () => {
    expect(
      parseReceipt(JSON.stringify({ orderId: 'order-1', lineCount: 1 })),
    ).toBeUndefined();
    expect(
      parseReceipt(
        JSON.stringify({ orderId: 'order-1', lineCount: 1, totals: [] }),
      ),
    ).toBeUndefined();
    // Every entry unreadable is the same as none: a receipt with no figure on
    // it is not a receipt.
    expect(
      parseReceipt(
        JSON.stringify({
          orderId: 'order-1',
          lineCount: 1,
          totals: ['nope', { currency: 'GTQ' }, { amount: 1 }],
        }),
      ),
    ).toBeUndefined();
  });

  it('ignores a placedAt that is not a string', () => {
    const receipt = parseReceipt(
      JSON.stringify({
        orderId: 'order-1',
        placedAt: 17,
        lineCount: 0,
        totals,
      }),
    );

    expect(receipt?.placedAt).toBeUndefined();
  });

  it('drops a line that is not shaped like one, keeping the rest', () => {
    const receipt = parseReceipt(
      JSON.stringify({
        orderId: 'order-1',
        lineCount: 2,
        totals,
        lines: [
          line('o-1'),
          'not a line',
          { offeringId: 7 },
          { offeringId: 'o-2', quantity: 'two', amount: 1, currency: 'GTQ' },
          { offeringId: 'o-3', quantity: 1, amount: 1 },
        ],
      }),
    );

    expect(receipt?.lines).toEqual([line('o-1')]);
  });

  it('reads lines that are not an array as absent', () => {
    const receipt = parseReceipt(
      JSON.stringify({
        orderId: 'order-1',
        lineCount: 1,
        totals,
        lines: 'nope',
      }),
    );

    expect(receipt?.lines).toBeUndefined();
  });
});

/**
 * The cancel capability the receipt carries.
 *
 * ⚠️ **The nonce lives here and nowhere else.** The order stores its SHA-256
 * digest, so this cookie is the only thing that can authorize the buyer's own
 * cancel — and it is still parsed as untrusted input, because a forged nonce
 * fails the server's compare exactly as a forged receipt fails to describe a
 * real order.
 */
describe('the cancel capability on a receipt', () => {
  const aLine = line('o-1');

  it('carries the nonce and the window when the order was placed with one', () => {
    const receipt = receiptFromOrder('order-1', undefined, [aLine], {
      cancelNonce: 'the-nonce',
      cancelWindowEndsAt: '2026-09-09T00:30:00.000Z',
    });

    expect(receipt.cancelNonce).toBe('the-nonce');
    expect(receipt.cancelWindowEndsAt).toBe('2026-09-09T00:30:00.000Z');
  });

  it('carries neither when the order was placed without one', () => {
    const receipt = receiptFromOrder('order-1', undefined, [aLine]);

    expect(receipt.cancelNonce).toBeUndefined();
    expect(receipt.cancelWindowEndsAt).toBeUndefined();
    expect('cancelNonce' in receipt).toBe(false);
  });

  /**
   * ⚠️ `true` only, and anything else is absent rather than `false`. The cookie
   * is `httpOnly` but its owner can still edit it, and a forged
   * `cancelled: 'yes'` must not make the page tell somebody their order was
   * cancelled when it was not.
   */
  it('reads a cancellation back only when it is exactly true', () => {
    const base = receiptFromOrder('order-1', undefined, [aLine]);

    const marked = parseReceipt(serializeReceipt({ ...base, cancelled: true }));
    expect(marked?.cancelled).toBe(true);

    for (const forged of ['yes', 1, {}, null]) {
      const parsed = parseReceipt(
        JSON.stringify({ ...base, cancelled: forged }),
      );
      expect(parsed?.cancelled).toBeUndefined();
      expect(parsed !== undefined && 'cancelled' in parsed).toBe(false);
    }
  });

  it('reads both back off the cookie', () => {
    const parsed = parseReceipt(
      serializeReceipt(
        receiptFromOrder('order-1', undefined, [aLine], {
          cancelNonce: 'the-nonce',
          cancelWindowEndsAt: '2026-09-09T00:30:00.000Z',
        }),
      ),
    );

    expect(parsed?.cancelNonce).toBe('the-nonce');
    expect(parsed?.cancelWindowEndsAt).toBe('2026-09-09T00:30:00.000Z');
  });

  /**
   * ⚠️ An empty or non-string capability is dropped rather than carried. A page
   * decides whether to offer the cancel by whether these are present, and an
   * empty nonce would render a button whose request is bound to fail.
   */
  it('drops a capability that is empty or the wrong type', () => {
    const receipt = receiptFromOrder('order-1', undefined, [aLine]);

    for (const bad of [
      { cancelNonce: '', cancelWindowEndsAt: '' },
      { cancelNonce: 7, cancelWindowEndsAt: false },
    ]) {
      const parsed = parseReceipt(JSON.stringify({ ...receipt, ...bad }));

      expect(parsed?.cancelNonce).toBeUndefined();
      expect(parsed?.cancelWindowEndsAt).toBeUndefined();
    }
  });
});
