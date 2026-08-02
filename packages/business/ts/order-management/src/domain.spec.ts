import { describe, expect, it } from 'vitest';

import { ORDER_DOMAIN } from './domain.js';

describe('ORDER_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(ORDER_DOMAIN).toBe('order-management');
  });
});
