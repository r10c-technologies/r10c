import { permissionForEntity } from '@r10c/business-ts-authz';
import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Role } from './role.entity.js';

describe('Role', () => {
  it('serializes a tenant-defined role and its grants', () => {
    const role = new Role('org-1', 'Sales');
    role.id = 'role-sales';
    role.permissions = ['order-management:*:read'];

    expect(serializeEntity(Role, role)).toEqual({
      id: 'role-sales',
      organizationId: 'org-1',
      name: 'Sales',
      permissions: ['order-management:*:read'],
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const role = await Effect.runPromise(
      deserializeSingleEntity(Role, {
        id: 'role-inventory',
        organizationId: 'org-1',
        name: 'Inventory',
        permissions: ['stock-management:*:read', 'stock-management:*:write'],
      }),
    );

    expect(role?.name).toBe('Inventory');
    expect(role?.permissions).toHaveLength(2);
  });

  it('is scoped to one organization, and queryable by it', () => {
    // A role table is per-organization data, not a global vocabulary. Without
    // this filter a resolver could not fetch one tenant's roles.
    const organizationId = describeEntityColumns(Role).find(
      column => column.name === 'organizationId',
    );

    expect(organizationId?.filterable).toBe(true);
  });

  it('grants nothing until permissions are assigned', () => {
    expect(new Role().permissions).toEqual([]);
  });

  it('derives the permissions guarding role administration from its own metadata', () => {
    expect(permissionForEntity(Role, 'read')).toBe(
      'access-management:role:read',
    );
    expect(permissionForEntity(Role, 'write')).toBe(
      'access-management:role:write',
    );
  });
});
