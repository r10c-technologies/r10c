import { describe, expect, it } from 'vitest';

import { PARTY_DOMAIN } from './domain.js';

describe('PARTY_DOMAIN', () => {
  it('matches the package name, which is what makes a permission namespace, an\n    entitlement key and a package identity the same word', () => {
    expect(PARTY_DOMAIN).toBe('party-management');
  });
});
