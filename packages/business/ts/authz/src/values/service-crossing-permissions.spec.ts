import { describe, expect, it } from 'vitest';

import { can, permissionsOf } from '../policy/can.js';
import { Roles } from './role.js';
import { ROLE_PERMISSIONS } from './role-permissions.js';
import {
  SERVICE_CROSSING_PERMISSIONS,
  serviceCrossingAllows,
} from './service-crossing-permissions.js';

describe('SERVICE_CROSSING_PERMISSIONS', () => {
  it('allows the one crossing the fleet has', () => {
    expect(serviceCrossingAllows('stock-management:reservation:write')).toBe(
      true,
    );
  });

  it('allows nothing else, including the neighbouring writes', () => {
    expect(serviceCrossingAllows('stock-management:reservation:read')).toBe(
      false,
    );
    expect(serviceCrossingAllows('stock-management:stock-movement:write')).toBe(
      false,
    );
    expect(
      serviceCrossingAllows('product-configuration-management:*:write'),
    ).toBe(false);
  });

  it('carries no wildcard segment', () => {
    // A `*` here would make holding the token the capability, rather than the
    // token proving fleet membership and this list saying what the fleet may
    // do — the split ADR 0023 turns on.
    for (const permission of SERVICE_CROSSING_PERMISSIONS) {
      expect(permission.split(':')).not.toContain('*');
    }
  });

  it('is granted to no role by name', () => {
    // ⚠️ The load-bearing invariant. `permissionsOf` expands grants by role
    // string, so a crossing permission written into ROLE_PERMISSIONS would ride
    // on any access token carrying that role.
    for (const role of Roles) {
      for (const crossing of SERVICE_CROSSING_PERMISSIONS) {
        expect(
          ROLE_PERMISSIONS[role],
          `${role} names ${crossing} literally`,
        ).not.toContain(crossing);
      }
    }
  });

  it('is reachable by super-admin through `*:*:*`, which is why the route takes no session', () => {
    // Not a defect in the table — `*:*:*` is the catch-all for capabilities that
    // do not exist yet, and narrowing it is not the fix. The fix is that the
    // reservation write accepts a crossing token and nothing else, so no
    // session, however privileged, is a credential for it.
    expect(can(['super-admin'], 'stock-management:reservation:write')).toBe(
      true,
    );
    expect(can(['admin'], 'stock-management:reservation:write')).toBe(false);
    expect(can(['user'], 'stock-management:reservation:write')).toBe(false);
  });

  it('is not reachable through the role expansion at all for a tenant role', () => {
    const tenantGrants = permissionsOf(['admin', 'user']);

    for (const crossing of SERVICE_CROSSING_PERMISSIONS) {
      expect(tenantGrants).not.toContain(crossing);
    }
  });
});
