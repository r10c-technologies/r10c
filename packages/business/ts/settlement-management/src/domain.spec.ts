import { describe, expect, it } from 'vitest';

import { SETTLEMENT_DOMAIN } from './domain.js';

describe('SETTLEMENT_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(SETTLEMENT_DOMAIN).toBe('settlement-management');
  });
});
