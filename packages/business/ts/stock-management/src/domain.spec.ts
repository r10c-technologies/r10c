import { describe, expect, it } from 'vitest';

import { STOCK_DOMAIN } from './domain.js';

describe('STOCK_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(STOCK_DOMAIN).toBe('stock-management');
  });
});
