import { EntifixBuildError } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readCancelledOrder, readPlacedOrder } from './placed-order.js';

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
      expect(await refused(payload)).toBeInstanceOf(EntifixBuildError);
    }
  });
});
