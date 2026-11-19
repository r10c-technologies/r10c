import { describe, expect, it } from 'vitest';

import {
  collectedByVendor,
  confirmedBySeller,
  isOrderTender,
  OrderTenders,
} from './order-tender.js';

describe('OrderTenders', () => {
  it('carries the four ways a buyer pays one vendor order', () => {
    expect(OrderTenders).toEqual(['card', 'cash', 'cod', 'link']);
  });

  it.each(OrderTenders)('accepts %s', value => {
    expect(isOrderTender(value)).toBe(true);
  });

  it.each(['cashOnDelivery', undefined, 7])('rejects %s', value => {
    expect(isOrderTender(value)).toBe(false);
  });
});

describe('confirmedBySeller', () => {
  it('is true for a payment link alone', () => {
    expect(OrderTenders.filter(confirmedBySeller)).toEqual(['link']);
  });
});

describe('collectedByVendor', () => {
  it('is true for cash on delivery and a payment link', () => {
    expect(OrderTenders.filter(collectedByVendor)).toEqual(['cod', 'link']);
  });
});
