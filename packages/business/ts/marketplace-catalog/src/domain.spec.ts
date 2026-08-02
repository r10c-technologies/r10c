import { describe, expect, it } from 'vitest';

import { MARKETPLACE_CATALOG_DOMAIN } from './domain.js';

describe('MARKETPLACE_CATALOG_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(MARKETPLACE_CATALOG_DOMAIN).toBe('marketplace-catalog');
  });
});
