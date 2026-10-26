import { describe, expect, it } from 'vitest';

import { basketTotal, checkoutInputs } from './checkout-inputs.js';
import { sagaOutcomeFor } from './saga-starter.js';

const line = (offeringId: string, quantity: number, amount: number) => ({
  offeringId,
  vendorId: `vendor-of-${offeringId}`,
  quantity,
  amount,
  currency: 'USD',
});

describe('checkoutInputs', () => {
  it('reserves each line in its vendor’s store, writes the order, and captures the total', () => {
    const inputs = checkoutInputs({
      lines: [line('o-1', 2, 10), line('o-2', 1, 5)],
      order: { cancelDigest: 'digest' },
      payment: { paymentMethod: 'card', fallbackCurrency: 'GTQ' },
    });

    expect(inputs['reserve']?.map(call => call.organizationId)).toEqual([
      'vendor-of-o-1',
      'vendor-of-o-2',
    ]);
    expect(inputs['write-order']?.[0]?.body).toMatchObject({
      data: {
        cancelDigest: 'digest',
        items: [{ offeringId: 'o-1' }, { offeringId: 'o-2' }],
      },
    });
    expect(inputs['capture-payment']?.[0]?.body).toEqual({
      meta: { type: 'entity', entity: 'payment' },
      data: {
        orderId: '{steps.write-order.data.id}',
        amount: 25,
        currency: 'USD',
        paymentMethod: 'card',
      },
    });
  });

  it('carries the channel onto the capture when the sale has one', () => {
    const inputs = checkoutInputs({
      lines: [line('o-1', 1, 3)],
      payment: {
        paymentMethod: 'cash',
        fallbackCurrency: 'GTQ',
        channelId: 'ch-1',
      },
    });

    expect(inputs['capture-payment']?.[0]?.body).toMatchObject({
      data: { channelId: 'ch-1' },
    });
  });
});

describe('basketTotal', () => {
  it('names an empty basket’s currency from the fallback', () => {
    expect(basketTotal([], 'GTQ')).toEqual({ amount: 0, currency: 'GTQ' });
  });
});

describe('sagaOutcomeFor', () => {
  it('reads 201 as completed, 409 as compensated, and anything else as failed', () => {
    expect(sagaOutcomeFor(201, 'r')).toEqual({
      _tag: 'completed',
      result: 'r',
    });
    expect(sagaOutcomeFor(409, 'r')).toEqual({
      _tag: 'compensated',
      result: 'r',
    });
    expect(sagaOutcomeFor(502, 'r')).toEqual({
      _tag: 'failed',
      status: 502,
      result: 'r',
    });
  });
});
