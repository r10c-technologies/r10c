import { describe, expect, it } from 'vitest';

import { isRefundStatus, RefundStatuses } from './refund-status.js';

describe('RefundStatuses', () => {
  it('has no authorization step, because nothing holds money on the way out', () => {
    expect(RefundStatuses).toEqual(['pending', 'refunded', 'failed']);
  });
});

describe('isRefundStatus', () => {
  it('accepts every declared status', () => {
    for (const status of RefundStatuses) {
      expect(isRefundStatus(status)).toBe(true);
    }
  });

  it('rejects a payment status, which is a separate vocabulary', () => {
    // The two unions answer different questions and drift apart the moment
    // either grows a member.
    expect(isRefundStatus('captured')).toBe(false);
    expect(isRefundStatus('authorized')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isRefundStatus(null)).toBe(false);
    expect(isRefundStatus(true)).toBe(false);
  });
});
