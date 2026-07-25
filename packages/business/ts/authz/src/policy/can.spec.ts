import { describe, expect, it } from 'vitest';

import {
  CATALOG_DOMAIN,
  ROLE_PERMISSIONS,
} from '../values/role-permissions.js';
import { can, permissionsOf } from './can.js';

describe('permissionsOf', () => {
  it('expands a known role into its grants', () => {
    expect(permissionsOf(['admin'])).toEqual(ROLE_PERMISSIONS.admin);
  });

  it('unions several roles', () => {
    expect(permissionsOf(['user', 'admin'])).toEqual([
      ...ROLE_PERMISSIONS.user,
      ...ROLE_PERMISSIONS.admin,
    ]);
  });

  it('drops unrecognised roles instead of widening access', () => {
    expect(permissionsOf(['root'])).toEqual([]);
  });
});

describe('can', () => {
  it('allows what a role grants', () => {
    expect(can(['user'], `${CATALOG_DOMAIN}:product:read`)).toBe(true);
  });

  it('denies what no role grants', () => {
    expect(can(['user'], 'authn:user-identity:read')).toBe(false);
  });

  it('honours the super-admin wildcard', () => {
    expect(can(['super-admin'], 'anything:at:all')).toBe(true);
  });

  it('denies a principal with no roles', () => {
    expect(can([], `${CATALOG_DOMAIN}:product:read`)).toBe(false);
  });
});
