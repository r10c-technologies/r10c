import { describe, expect, it } from 'vitest';

import { ACCESS_DOMAIN } from './domain.js';

describe('ACCESS_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(ACCESS_DOMAIN).toBe('access-management');
  });
});
