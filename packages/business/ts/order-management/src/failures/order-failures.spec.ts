import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  CancelNotAuthorized,
  OrderNotCancellable,
  OrderNotTransitionable,
  PaymentPending,
} from './order-failures.js';

describe('the order refusals', () => {
  it('are typed failures with the codes the errors catalog renders', () => {
    const refusals = [
      new OrderNotCancellable({ orderId: 'o', reason: 'past cancelling' }),
      new OrderNotTransitionable({
        orderId: 'o',
        standing: 'pending',
        transition: 'close-fulfilled',
      }),
      new PaymentPending({ orderId: 'o' }),
      new CancelNotAuthorized(),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(refusals.map(refusal => [refusal.code, refusal.category])).toEqual([
      ['orderNotCancellable', 'conflict'],
      ['orderNotTransitionable', 'conflict'],
      ['paymentPending', 'conflict'],
      ['cancelNotAuthorized', 'unauthenticated'],
    ]);
    expect(refusals.map(refusal => refusal.message)).toEqual([
      'past cancelling',
      "an order in 'pending' cannot close-fulfilled",
      'the payment is still being confirmed',
      'the order cannot be cancelled from here',
    ]);
  });
});
