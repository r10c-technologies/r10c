import { Invalid } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  orderAudience,
  readCancelledOrder,
  readPlacedOrder,
} from './order-event.js';

const line = { amount: 10, quantity: 2, currency: 'GTQ' };

const fullLine = {
  ...line,
  offeringId: 'off-1',
  name: 'Cog',
  kind: 'good',
  taxTreatment: 'taxed',
  taxRate: 0.12,
  taxableBase: 18,
  taxAmount: 2,
};

const order = {
  id: 'o-1',
  vendorId: 'v-1',
  groupId: 'g-1',
  paymentMethod: 'card',
  status: 'paid',
  items: [fullLine],
  sellerTax: {
    taxId: '1234567-8',
    legalName: 'Ferretería Demo',
    taxRegime: 'general',
    establishmentCode: '1',
  },
  netAmount: 18,
  taxAmount: 2,
  totalAmount: 20,
  currency: 'GTQ',
};

const refused = (data: unknown) =>
  Effect.runPromise(Effect.flip(readPlacedOrder(data)));

describe('readPlacedOrder', () => {
  it('reads the vendor order, its group and tender, its lines and the channel type', async () => {
    const placed = await Effect.runPromise(
      readPlacedOrder({ ...order, channel: { type: 'counter' } }),
    );

    expect(placed).toEqual({
      orderId: 'o-1',
      vendorId: 'v-1',
      groupId: 'g-1',
      paymentMethod: 'card',
      // Each line carries the order's vendor for a reader pricing per line.
      lines: [{ ...line, vendorId: 'v-1' }],
      channelType: 'counter',
    });
  });

  it('reads an order with no channel — the storefront’s — as having none', async () => {
    const cancelled = await Effect.runPromise(
      readCancelledOrder({ ...order, id: 'o-2', channel: null }),
    );

    expect(cancelled).toEqual({
      orderId: 'o-2',
      vendorId: 'v-1',
      groupId: 'g-1',
      paymentMethod: 'card',
      lines: [{ ...line, vendorId: 'v-1' }],
    });
  });

  it('refuses a payload a fold could only get wrong', async () => {
    const payloads: unknown[] = [
      'not an object',
      { ...order, id: undefined },
      { ...order, vendorId: '' },
      { ...order, groupId: undefined },
      { ...order, paymentMethod: '' },
      { ...order, items: [] },
      { ...order, channel: { name: 'no type' } },
      { ...order, items: [null] },
      { ...order, items: [{ ...fullLine, amount: Number.NaN }] },
      { ...order, items: [{ ...fullLine, quantity: 'two' }] },
      { ...order, items: [{ ...fullLine, currency: '' }] },
      // The whole fact (ADR 0078 §2): a fiscal member missing is a wrong ledger
      // entry, not a smaller one.
      { ...order, items: [line] },
      { ...order, items: [{ ...fullLine, taxAmount: undefined }] },
      { ...order, items: [{ ...fullLine, offeringId: '' }] },
      { ...order, sellerTax: undefined },
      { ...order, sellerTax: { ...order.sellerTax, taxRegime: '' } },
      { ...order, netAmount: undefined },
      { ...order, taxAmount: Number.NaN },
      { ...order, totalAmount: '20' },
      { ...order, status: '' },
      { ...order, currency: undefined },
    ];

    for (const payload of payloads) {
      expect(await refused(payload)).toBeInstanceOf(Invalid);
    }
  });
});

describe('orderAudience', () => {
  it('addresses the buyer and the order’s one vendor', () => {
    expect(orderAudience({ buyerId: 'p-1', vendorId: 'v-1' })).toEqual([
      { kind: 'party', id: 'p-1' },
      { kind: 'organization', id: 'v-1' },
    ]);
  });

  it('addresses only the vendor of an anonymous buyer, and nobody for neither', () => {
    expect(orderAudience({ vendorId: 'v-1' })).toEqual([
      { kind: 'organization', id: 'v-1' },
    ]);
    expect(orderAudience({ vendorId: '' })).toEqual([]);
    expect(orderAudience({})).toEqual([]);
  });

  it('addresses the anonymous buyer’s receipt by the digest its group keeps', () => {
    expect(
      orderAudience({ vendorId: 'v-1', groupId: 'g-1' }, 'digest-1'),
    ).toEqual([
      { kind: 'organization', id: 'v-1' },
      { kind: 'flow', id: 'g-1', digest: 'digest-1' },
    ]);
  });

  it('adds no receipt entry without a digest or a group', () => {
    expect(orderAudience({ vendorId: 'v-1', groupId: 'g-1' }, '')).toEqual([
      { kind: 'organization', id: 'v-1' },
    ]);
    expect(orderAudience({ vendorId: 'v-1', groupId: '' }, 'd')).toEqual([
      { kind: 'organization', id: 'v-1' },
    ]);
    expect(orderAudience({ vendorId: 'v-1' }, 'd')).toEqual([
      { kind: 'organization', id: 'v-1' },
    ]);
  });
});
