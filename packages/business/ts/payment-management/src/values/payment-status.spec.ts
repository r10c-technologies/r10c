import { describe, expect, it } from 'vitest';

import { isPaymentStatus, PaymentStatuses } from './payment-status.js';

describe('PaymentStatuses', () => {
  it('keeps authorization and capture apart, as a real provider does', () => {
    // Collapsing them into a single `paid` would make the eventual PSP adapter
    // model something this domain cannot express — a hold taken at checkout and
    // settled on dispatch.
    expect(PaymentStatuses).toEqual([
      'pending',
      'authorized',
      'captured',
      'failed',
    ]);
  });
});

describe('isPaymentStatus', () => {
  it('accepts every declared status', () => {
    for (const status of PaymentStatuses) {
      expect(isPaymentStatus(status)).toBe(true);
    }
  });

  it('rejects an order status, which is a separate vocabulary', () => {
    expect(isPaymentStatus('fulfilled')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isPaymentStatus(null)).toBe(false);
    expect(isPaymentStatus(true)).toBe(false);
  });
});
