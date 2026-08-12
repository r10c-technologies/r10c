import { describe, expect, it } from 'vitest';

import { isOrderStatus, OrderStatuses } from './order-status.js';

describe('OrderStatuses', () => {
  it('describes money and promises, not logistics', () => {
    // No `shipped`: fulfillment is out of v1 scope, and adding it later is a
    // member here rather than a second status field.
    expect(OrderStatuses).toEqual([
      'pending',
      'paid',
      'fulfilled',
      'cancelled',
    ]);
  });

  it('opens as `pending`, before any money has moved', () => {
    expect(OrderStatuses[0]).toBe('pending');
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
