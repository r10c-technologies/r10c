import { describe, expect, it } from 'vitest';

import {
  CodNotEntitled,
  CodOverLimit,
  RefundExceedsCapture,
} from './payment-failures.js';

describe('the payment refusals', () => {
  it('say what was asked and what was left', () => {
    expect(
      new RefundExceedsCapture({ orderId: 'o', requested: 5, remaining: 2 })
        .message,
    ).toBe('5 asked back, 2 left to refund');
    expect(
      new CodOverLimit({ vendorId: 'v', amount: 200, limit: 150 }).message,
    ).toBe('200 is over the cash-on-delivery limit of 150');
    expect(new CodNotEntitled({ vendorId: 'v' }).message).toBe(
      'vendor v does not accept cash on delivery',
    );
  });

  it('carry the codes the errors catalog translates', () => {
    expect([
      new RefundExceedsCapture({ orderId: 'o', requested: 1, remaining: 0 })
        .code,
      new CodOverLimit({ vendorId: 'v', amount: 1, limit: 0 }).code,
      new CodNotEntitled({ vendorId: 'v' }).code,
    ]).toEqual(['refundExceedsCapture', 'codOverLimit', 'codNotEntitled']);
  });
});
