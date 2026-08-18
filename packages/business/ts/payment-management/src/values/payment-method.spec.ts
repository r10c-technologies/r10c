import { describe, expect, it } from 'vitest';

import { isPaymentMethod, PaymentMethods } from './payment-method.js';

describe('PaymentMethods', () => {
  it('carries the four tenders a vendor can actually be handed', () => {
    expect(PaymentMethods).toEqual(['cash', 'card', 'voucher', 'transfer']);
  });

  it('includes cash, which is the member that makes the field worth having', () => {
    // Every payment before in-site selling was a storefront card, so the method
    // was inferable. A vendor taking notes at a counter cannot be (ADR 0024).
    expect(PaymentMethods).toContain('cash');
  });
});

describe('isPaymentMethod', () => {
  it.each(PaymentMethods)('accepts %s', value => {
    expect(isPaymentMethod(value)).toBe(true);
  });

  it('rejects a string outside the set', () => {
    expect(isPaymentMethod('crypto')).toBe(false);
  });

  it.each([undefined, null, 3, {}])('rejects the non-string %s', value => {
    expect(isPaymentMethod(value)).toBe(false);
  });
});
