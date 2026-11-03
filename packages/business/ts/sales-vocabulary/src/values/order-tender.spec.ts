import { describe, expect, it } from 'vitest';

import { isOrderTender, OrderTenders } from './order-tender.js';

describe('OrderTenders', () => {
  it('carries the three ways a buyer pays one vendor order', () => {
    expect(OrderTenders).toEqual(['card', 'cash', 'cod']);
  });

  it.each(OrderTenders)('accepts %s', value => {
    expect(isOrderTender(value)).toBe(true);
  });

  it.each(['cashOnDelivery', undefined, 7])('rejects %s', value => {
    expect(isOrderTender(value)).toBe(false);
  });
});
