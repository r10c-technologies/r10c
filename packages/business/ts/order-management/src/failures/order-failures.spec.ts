import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  CancelNotAuthorized,
  MultiVendorOrder,
  OrderNotCancellable,
  OrderNotFulfillable,
  PaymentPending,
} from './order-failures.js';

describe('the order refusals', () => {
  it('are typed failures with the codes the errors catalog renders', () => {
    const refusals = [
      new OrderNotCancellable({ orderId: 'o', reason: 'past cancelling' }),
      new OrderNotFulfillable({ orderId: 'o', reason: 'not paid' }),
      new MultiVendorOrder({ orderId: 'o' }),
      new PaymentPending({ orderId: 'o' }),
      new CancelNotAuthorized(),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(refusals.map(refusal => [refusal.code, refusal.category])).toEqual([
      ['orderNotCancellable', 'conflict'],
      ['orderNotFulfillable', 'conflict'],
      ['multiVendorOrder', 'conflict'],
      ['paymentPending', 'conflict'],
      ['cancelNotAuthorized', 'unauthenticated'],
    ]);
    expect(refusals.map(refusal => refusal.message)).toEqual([
      'past cancelling',
      'not paid',
      'a vendor cannot cancel an order that names another',
      'the payment is still being confirmed',
      'the order cannot be cancelled from here',
    ]);
  });
});
