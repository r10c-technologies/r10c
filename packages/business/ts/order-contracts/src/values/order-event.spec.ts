import { Invalid } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  orderAudience,
  readCancelledOrder,
  readPlacedOrder,
} from './order-event.js';

const line = { amount: 10, quantity: 2, currency: 'GTQ' };

const order = {
  id: 'o-1',
  vendorId: 'v-1',
  groupId: 'g-1',
  paymentMethod: 'card',
  items: [line],
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
      { ...order, items: [{ ...line, amount: Number.NaN }] },
      { ...order, items: [{ ...line, quantity: 'two' }] },
      { ...order, items: [{ ...line, currency: '' }] },
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
});
