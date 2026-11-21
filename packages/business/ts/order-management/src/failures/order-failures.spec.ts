import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  CancelNotAuthorized,
  EvidenceLimitReached,
  EvidenceTooLarge,
  EvidenceTypeRefused,
  InvalidPaymentDetails,
  OrderNotAwaitingPayment,
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
      new OrderNotAwaitingPayment({ orderId: 'o', standing: 'cancelled' }),
      new InvalidPaymentDetails({ field: 'url', reason: 'https only' }),
      new EvidenceTypeRefused(),
      new EvidenceTooLarge({ maxBytes: 5 }),
      new EvidenceLimitReached({ maxCount: 3 }),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(refusals.map(refusal => [refusal.code, refusal.category])).toEqual([
      ['orderNotCancellable', 'conflict'],
      ['orderNotTransitionable', 'conflict'],
      ['paymentPending', 'conflict'],
      ['cancelNotAuthorized', 'unauthenticated'],
      ['orderNotAwaitingPayment', 'conflict'],
      ['invalidPaymentDetails', 'invalid'],
      ['evidenceTypeRefused', 'invalid'],
      ['evidenceTooLarge', 'invalid'],
      ['evidenceLimitReached', 'declined'],
    ]);
    expect(refusals.map(refusal => refusal.message)).toEqual([
      'past cancelling',
      "an order in 'pending' cannot close-fulfilled",
      'the payment is still being confirmed',
      'the order cannot be cancelled from here',
      "an order in 'cancelled' is not waiting for its payment",
      'https only',
      'a receipt is a JPEG, PNG, WebP or PDF file',
      'a receipt is at most 5 bytes',
      'an order holds at most 3 receipts',
    ]);
  });
});
