import {
  defineCatalog,
  fragmentRef,
  type Slip,
  validateSlip,
} from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import { PAYMENT_FRAGMENTS, paymentCapture } from './payment-fragments';

const catalog = defineCatalog([...PAYMENT_FRAGMENTS]);

const captureIn = (paymentMethod: string): Slip => ({
  slipVersion: 1,
  flowId: 'f',
  recipe: 'checkout',
  stages: [
    {
      name: 'pay',
      steps: [
        {
          ref: fragmentRef(paymentCapture),
          step: 'capture',
          cardinality: 'one',
          segment: { paymentMethod },
        },
      ],
    },
  ],
  resolution: [],
  composedAt: '2026-10-28T00:00:00.000Z',
});

describe('payment fragments', () => {
  it('are two irreversible pivots', () => {
    expect(PAYMENT_FRAGMENTS.map(fragmentRef)).toEqual([
      'payment.capture@1',
      'payment.refund@1',
    ]);
    expect(
      PAYMENT_FRAGMENTS.every(f => f.kind === 'pivot' && f.irreversible),
    ).toBe(true);
  });

  it('let a card segment capture', () => {
    expect(validateSlip(captureIn('card'), catalog)).toEqual([]);
  });

  // Cash on delivery takes no money at checkout: the courier does, later.
  it('refuse a capture inside a cash-on-delivery segment', () => {
    expect(
      validateSlip(captureIn('cashOnDelivery'), catalog).map(v => v.tag),
    ).toEqual(['ExcludedFromSegment']);
  });
});
