import { describe, expect, it } from 'vitest';

import { CATALOG_REFERENCE_DOMAIN } from './domain.js';

describe('CATALOG_REFERENCE_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(CATALOG_REFERENCE_DOMAIN).toBe('catalog-reference');
  });
});
