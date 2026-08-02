import { describe, expect, it } from 'vitest';

import { PAYMENT_DOMAIN } from './domain.js';

describe('PAYMENT_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(PAYMENT_DOMAIN).toBe('payment-management');
  });
});
