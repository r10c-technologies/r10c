import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { RefundDeclined } from './refund-declined.js';

describe('RefundDeclined', () => {
  it('is a declined failure addressed by order', () => {
    const declined = new RefundDeclined({ orderId: 'order-1' });

    expect(isFailure(declined)).toBe(true);
    expect(declined.category).toBe('declined');
    expect(declined.code).toBe('refundDeclined');
    expect(declined.message).toBe('the refund was not made');
  });

  it('carries the provider reason as its message when it has one', () => {
    expect(
      new RefundDeclined({ orderId: 'order-1', reason: 'card expired' })
        .message,
    ).toBe('card expired');
  });
});
