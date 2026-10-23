import { describe, expect, it } from 'vitest';

import { MARKETPLACE_VENDOR_DOMAIN } from './domain.js';

describe('MARKETPLACE_VENDOR_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an entitlement key and a package identity the same word', () => {
    expect(MARKETPLACE_VENDOR_DOMAIN).toBe('marketplace-vendor');
  });
});
