import { describe, expect, it } from 'vitest';

import {
  isPermissionEntitled,
  unentitledPermissions,
} from './entitlement-ceiling.js';

const entitled = ['product-configuration-management', 'stock-management'];

describe('isPermissionEntitled', () => {
  it('allows a permission inside a provisioned domain', () => {
    expect(isPermissionEntitled(entitled, 'stock-management:*:write')).toBe(
      true,
    );
  });

  it('refuses a permission in a domain the organization did not buy', () => {
    expect(isPermissionEntitled(entitled, 'settlement-management:*:read')).toBe(
      false,
    );
  });

  it('refuses a wildcard domain outright', () => {
    // Wildcards belong to *granted* platform permissions, where the grant table
    // is code we wrote. A tenant-authored role naming `*` would grant every
    // domain the platform ever adds, including ones nobody sold them.
    expect(isPermissionEntitled(entitled, '*:*:*')).toBe(false);
  });
});

describe('unentitledPermissions', () => {
  it('returns nothing when every permission is covered', () => {
    expect(
      unentitledPermissions(entitled, [
        'stock-management:*:read',
        'product-configuration-management:product:write',
      ]),
    ).toEqual([]);
  });

  it('names the offenders rather than answering a bare no', () => {
    // What lets a caller say which domain is missing instead of a blank 403.
    expect(
      unentitledPermissions(entitled, [
        'stock-management:*:read',
        'order-management:*:write',
        'payment-management:*:read',
      ]),
    ).toEqual(['order-management:*:write', 'payment-management:*:read']);
  });
});
