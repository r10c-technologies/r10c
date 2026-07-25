import { describe, expect, it } from 'vitest';

import { permissionMatches } from './permission.js';
import { Roles } from './role.js';
import {
  AUTHN_DOMAIN,
  CATALOG_DOMAIN,
  ROLE_PERMISSIONS,
} from './role-permissions.js';

describe('ROLE_PERMISSIONS', () => {
  it('grants every role a table entry', () => {
    for (const role of Roles) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('gives a plain user catalog reads but no user management', () => {
    const granted = ROLE_PERMISSIONS.user;
    expect(
      granted.some(permission =>
        permissionMatches(permission, `${CATALOG_DOMAIN}:product:read`),
      ),
    ).toBe(true);
    expect(
      granted.some(permission =>
        permissionMatches(permission, `${AUTHN_DOMAIN}:user-identity:read`),
      ),
    ).toBe(false);
  });

  it('gives an admin catalog writes and user management', () => {
    const granted = ROLE_PERMISSIONS.admin;
    expect(
      granted.some(permission =>
        permissionMatches(permission, `${CATALOG_DOMAIN}:product:write`),
      ),
    ).toBe(true);
    expect(
      granted.some(permission =>
        permissionMatches(permission, `${AUTHN_DOMAIN}:user-identity:write`),
      ),
    ).toBe(true);
  });

  it('gives a super-admin the unrestricted wildcard', () => {
    expect(ROLE_PERMISSIONS['super-admin']).toEqual(['*:*:*']);
  });
});
