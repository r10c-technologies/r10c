import { describe, expect, it } from 'vitest';

import { isOrderStatus, OrderStatuses } from './order-status.js';

describe('OrderStatuses', () => {
  it('follows one vendor order from checkout to delivery or cancellation', () => {
    expect(OrderStatuses).toEqual([
      'pending',
      'paid',
      'confirmed',
      'cancelling',
      'dispatched',
      'fulfilled',
      'cancelled',
    ]);
  });

  it('opens as `pending`, before any money has moved', () => {
    expect(OrderStatuses[0]).toBe('pending');
  });

  it('carries the claim a cancellation takes before it refunds', () => {
    // `cancelling` is the conditional write that stops two cancels running at
    // once. Without it in the vocabulary there is nothing for the claim to
    // write, and the concurrency guard is a comment (ADR 0058 §3).
    expect(OrderStatuses).toContain('cancelling');
  });
});

describe('isOrderStatus', () => {
  it('accepts every declared status', () => {
    for (const status of OrderStatuses) {
      expect(isOrderStatus(status)).toBe(true);
    }
  });

  it('rejects a reservation status, which is a separate vocabulary', () => {
    // An order status is the buyer's view and a reservation status is the
    // vendor's stock. Collapsing them would make one domain write the other's
    // record.
    expect(isOrderStatus('held')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isOrderStatus(undefined)).toBe(false);
    expect(isOrderStatus(0)).toBe(false);
  });
});
