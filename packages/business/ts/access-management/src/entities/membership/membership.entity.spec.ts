import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Membership } from './membership.entity.js';

describe('Membership', () => {
  it('serializes the party, the organization and the roles held there', () => {
    const membership = new Membership('ind-1', 'org-1');
    membership.id = 'mem-1';
    membership.roleIds = ['role-sales'];
    membership.isDefault = true;

    expect(serializeEntity(Membership, membership)).toEqual({
      id: 'mem-1',
      partyId: 'ind-1',
      organizationId: 'org-1',
      roleIds: ['role-sales'],
      isDefault: true,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const membership = await Effect.runPromise(
      deserializeSingleEntity(Membership, {
        id: 'mem-2',
        partyId: 'ind-2',
        organizationId: 'org-2',
        roleIds: ['role-inventory', 'role-sales'],
        isDefault: false,
      }),
    );

    expect(membership?.organizationId).toBe('org-2');
    expect(membership?.roleIds).toEqual(['role-inventory', 'role-sales']);
  });

  it('starts with no roles and not default, so nothing is granted implicitly', () => {
    const membership = new Membership();

    expect(membership.roleIds).toEqual([]);
    expect(membership.isDefault).toBe(false);
  });

  it('keeps roleIds on the wire but out of the query allowlist', () => {
    // An array is not in the `MetaAccessorTypes` taxonomy, so it is declared as
    // its element type with sorting and filtering off — member metadata is also
    // the server-side allowlist, and an array compared as a string matches
    // nothing. `hidden` would have been the wrong tool: it drops a member from
    // serialization *and* deserialization, so the roles would never persist.
    const roleIds = describeEntityColumns(Membership).find(
      column => column.name === 'roleIds',
    );

    expect(roleIds?.filterable).toBe(false);
    expect(roleIds?.sortable).toBe(false);

    const membership = new Membership('ind-3', 'org-3');
    membership.roleIds = ['role-x'];
    expect(serializeEntity(Membership, membership)).toMatchObject({
      roleIds: ['role-x'],
    });
  });

  it('allows looking a membership up by party and by organization', () => {
    // The two lookups tenancy resolution needs: which organizations may this
    // party act for, and who belongs to this organization.
    const filterable = describeEntityColumns(Membership)
      .filter(column => column.filterable)
      .map(column => column.name);

    expect(filterable).toContain('partyId');
    expect(filterable).toContain('organizationId');
    expect(filterable).toContain('isDefault');
  });
});
