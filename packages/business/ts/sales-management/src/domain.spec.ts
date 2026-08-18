import { describe, expect, it } from 'vitest';

import { SALES_DOMAIN } from './domain.js';

describe('SALES_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(SALES_DOMAIN).toBe('sales-management');
  });
});
