import {
  defineCatalog,
  fragmentRef,
  type Slip,
  validateSlip,
} from '@entifix/business/flow';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PAYMENT_FRAGMENTS, paymentCapture } from './payment-fragments.js';

const catalog = defineCatalog([...PAYMENT_FRAGMENTS]);

/** What the steps before the capture bind: the group, and each vendor's order. */
const bound = { start: { groupId: Schema.String, orderId: Schema.String } };

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
  it('are two irreversible pivots, a retried refund and two collections, and a read-only check', () => {
    expect(PAYMENT_FRAGMENTS.map(fragmentRef)).toEqual([
      'payment.capture@4',
      'payment.refund@2',
      'payment.refund-after-delivery@1',
      'payment.record-collection@2',
      'payment.record-confirmation@1',
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
      'retriable',
      'retriable',
      'compensatable',
    ]);
    expect(PAYMENT_FRAGMENTS[5]?.readOnly).toBe(true);
  });

  it('records a confirmed link on the collection route, per vendor, under the reference the flow bound', () => {
    const [, , , collection, confirmation] = PAYMENT_FRAGMENTS;
    expect(confirmation).toMatchObject({
      call: collection.call,
      cardinality: 'perVendor',
    });
    expect(Object.keys(confirmation.consumes ?? {})).toEqual([
      'orderId',
      'paymentReference',
    ]);
  });

  it('refunds after a delivery on the refund’s own route, contract and refusals', () => {
    const [, refund, afterDelivery] = PAYMENT_FRAGMENTS;
    expect(afterDelivery).toMatchObject({
      call: refund.call,
      contract: refund.contract,
      irreversible: true,
    });
  });

  it('let a card segment capture', () => {
    expect(validateSlip(captureIn('card'), catalog, bound)).toEqual([]);
  });

  // Cash on delivery takes no money at checkout: the courier does, later.
  it('refuse a capture inside a cash-on-delivery segment', () => {
    expect(
      validateSlip(captureIn('cod'), catalog, bound).map(v => v.tag),
    ).toEqual(['ExcludedFromSegment']);
  });
});
