import {
  defineCatalog,
  fragmentRef,
  type Slip,
  validateSlip,
} from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import { PAYMENT_FRAGMENTS, paymentCapture } from './payment-fragments.js';

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
  it('are two irreversible pivots, a retried collection and a read-only check', () => {
    expect(PAYMENT_FRAGMENTS.map(fragmentRef)).toEqual([
      'payment.capture@2',
      'payment.refund@2',
      'payment.record-collection@1',
      'payment.cod-eligible@1',
    ]);
    expect(
      PAYMENT_FRAGMENTS.filter(f => f.kind === 'pivot').every(
        f => f.irreversible,
      ),
    ).toBe(true);
    expect(PAYMENT_FRAGMENTS.map(f => f.kind)).toEqual([
      'pivot',
      'pivot',
      'retriable',
      'compensatable',
    ]);
    expect(PAYMENT_FRAGMENTS[3]?.readOnly).toBe(true);
  });

  it('let a card segment capture', () => {
    expect(validateSlip(captureIn('card'), catalog)).toEqual([]);
  });

  // Cash on delivery takes no money at checkout: the courier does, later.
  it('refuse a capture inside a cash-on-delivery segment', () => {
    expect(validateSlip(captureIn('cod'), catalog).map(v => v.tag)).toEqual([
      'ExcludedFromSegment',
    ]);
  });
});
