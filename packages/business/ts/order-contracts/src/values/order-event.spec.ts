import { Invalid } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  orderAudience,
  readCancelledOrder,
  readPlacedOrder,
} from './order-event.js';

const line = { vendorId: 'v-1', amount: 10, quantity: 2, currency: 'GTQ' };

const refused = (data: unknown) =>
  Effect.runPromise(Effect.flip(readPlacedOrder(data)));

describe('readPlacedOrder', () => {
  it('reads the order, its vendor-tagged lines and the channel type the receipt carries', async () => {
    const order = await Effect.runPromise(
      readPlacedOrder({
        id: 'o-1',
        items: [line],
        channel: { type: 'counter' },
      }),
    );

    expect(order).toEqual({
      orderId: 'o-1',
      lines: [line],
      channelType: 'counter',
    });
  });

  it('reads an order with no channel — the storefront’s — as having none', async () => {
    const order = await Effect.runPromise(
      readCancelledOrder({ id: 'o-2', items: [line], channel: null }),
    );

    expect(order).toEqual({ orderId: 'o-2', lines: [line] });
  });

  it('refuses a payload a fold could only get wrong', async () => {
    const payloads: unknown[] = [
      'not an object',
      { items: [line] },
      { id: 'o', items: [] },
      { id: 'o', items: [line], channel: { name: 'no type' } },
      { id: 'o', items: [null] },
      { id: 'o', items: [{ ...line, vendorId: '' }] },
      { id: 'o', items: [{ ...line, amount: Number.NaN }] },
      { id: 'o', items: [{ ...line, quantity: 'two' }] },
      { id: 'o', items: [{ ...line, currency: '' }] },
    ];

    for (const payload of payloads) {
      expect(await refused(payload)).toBeInstanceOf(Invalid);
    }
  });
});

describe('orderAudience', () => {
  it('addresses the buyer and every vendor on the order, once each', () => {
    expect(
      orderAudience({
        buyerId: 'p-1',
        items: [{ vendorId: 'v-1' }, { vendorId: 'v-2' }, { vendorId: 'v-1' }],
      }),
    ).toEqual([
      { kind: 'party', id: 'p-1' },
      { kind: 'organization', id: 'v-1' },
      { kind: 'organization', id: 'v-2' },
    ]);
  });

  it('addresses only the vendors of an anonymous buyer, and nobody for no lines', () => {
    expect(orderAudience({ items: [{ vendorId: 'v-1' }] })).toEqual([
      { kind: 'organization', id: 'v-1' },
    ]);
    expect(orderAudience({})).toEqual([]);
  });
});
