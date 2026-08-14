import { describe, expect, it } from 'vitest';

import { permissionMatches } from './permission.js';
import { Roles } from './role.js';
import {
  AUTHN_DOMAIN,
  CATALOG_DOMAIN,
  CATALOG_REFERENCE_DOMAIN,
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

  // ADR 0022 decision 1: `catalog-reference` is operator-owned. A tenant role
  // that could write it would let one vendor rewrite the browse tree every
  // other vendor is classified into — a privilege escalation, not a
  // convenience. Reads are granted because marketplace-service serves them to
  // anonymous traffic anyway, and the nav has to name the same permission its
  // destination checks.
  it('lets a non-operator read the platform vocabulary but never author it', () => {
    for (const role of ['user', 'admin'] as const) {
      const granted = ROLE_PERMISSIONS[role];

      expect(
        granted.some(permission =>
          permissionMatches(
            permission,
            `${CATALOG_REFERENCE_DOMAIN}:product-brand:read`,
          ),
        ),
      ).toBe(true);

      for (const action of ['write', 'delete'] as const) {
        expect(
          granted.some(permission =>
            permissionMatches(
              permission,
              `${CATALOG_REFERENCE_DOMAIN}:product-brand:${action}`,
            ),
          ),
        ).toBe(false);
      }
    }
  });

  it('gives a super-admin the unrestricted wildcard', () => {
    expect(ROLE_PERMISSIONS['super-admin']).toEqual(['*:*:*']);
  });
});
