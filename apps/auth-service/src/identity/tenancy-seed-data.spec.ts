import { SEEDED_VENDORS } from '@r10c/utils-ts-fleet';
import { describe, expect, it } from 'vitest';

import {
  ALAN,
  membershipSeedData,
  organizationSeedData,
  secondMembershipSeedData,
  VENDOR_MEMBERS,
  vendorMemberSeedData,
} from './tenancy-seed-data';

describe('the seeded tenancy', () => {
  it('has a member for every seeded vendor, and no vendor without one', () => {
    // Positional on purpose; a vendor added to the fleet's list with no member
    // here would be an organization nobody can sign in to.
    expect(VENDOR_MEMBERS).toHaveLength(SEEDED_VENDORS.length);
    expect(new Set(VENDOR_MEMBERS.map(member => member.userId)).size).toBe(
      VENDOR_MEMBERS.length,
    );
  });

  it('names each organization after its seeded vendor', () => {
    expect(SEEDED_VENDORS.flatMap(organizationSeedData)).toEqual(
      SEEDED_VENDORS.map(vendor =>
        expect.objectContaining({
          id: vendor.organizationId,
          name: vendor.name,
          slug: vendor.slug,
        }),
      ),
    );
  });

  it('grants each member a role inside their own organization only', () => {
    const { membership, role, partyRole } = vendorMemberSeedData('org-x', ALAN);

    expect(membership).toEqual([
      expect.objectContaining({
        organizationId: 'org-x',
        roleIds: [role[0]?.id],
      }),
    ]);
    expect(role[0]).toMatchObject({ organizationId: 'org-x' });
    expect(partyRole[0]).toMatchObject({
      organizationId: 'org-x',
      role: 'vendor',
    });
    expect(membershipSeedData('org-x')).toEqual(membership);
  });

  it('adds a second membership that is not the default, under that organization’s own role', () => {
    const { membership, partyRole } = secondMembershipSeedData('org-y', ALAN);

    expect(membership).toEqual([
      expect.objectContaining({
        partyId: ALAN.partyId,
        organizationId: 'org-y',
        roleIds: ['role-org-y-catalog'],
        isDefault: false,
      }),
    ]);
    expect(partyRole[0]).toMatchObject({
      organizationId: 'org-y',
      role: 'vendor',
    });
    expect(membership[0]?.id).not.toBe(
      vendorMemberSeedData('org-x', ALAN).membership[0]?.id,
    );
  });
});
