import { describe, expect, it } from 'vitest';

import {
  isPartyRoleName,
  PartyRoles,
  PLANE_FOR_PARTY_ROLE,
} from './party-role.js';

describe('PartyRoles', () => {
  it('narrows a known role name', () => {
    expect(isPartyRoleName('vendor')).toBe(true);
  });

  it('rejects anything else, since the value selects a storage boundary', () => {
    expect(isPartyRoleName('admin')).toBe(false);
    expect(isPartyRoleName(undefined)).toBe(false);
    expect(isPartyRoleName(42)).toBe(false);
  });

  it('maps every role to a plane, so the mapping cannot go stale', () => {
    expect(Object.keys(PLANE_FOR_PARTY_ROLE).sort()).toEqual(
      [...PartyRoles].sort(),
    );
  });

  it('gives an operator no tenant scope', () => {
    // Not an oversight. Reaching tenant data is an explicit, audited
    // act-as-organization crossing (ADR 0012), never a wider default — so a
    // resolver bug cannot silently promote every vendor.
    expect(PLANE_FOR_PARTY_ROLE.operator).toBe('control');
    expect(PLANE_FOR_PARTY_ROLE.vendor).toBe('tenant');
    expect(PLANE_FOR_PARTY_ROLE.customer).toBe('platform');
  });
});
