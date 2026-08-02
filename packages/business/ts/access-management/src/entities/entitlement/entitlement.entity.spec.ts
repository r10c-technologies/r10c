import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Entitlement } from './entitlement.entity.js';

describe('Entitlement', () => {
  it('serializes the domains an organization is provisioned for', () => {
    const entitlement = new Entitlement('org-1', [
      'product-configuration-management',
      'stock-management',
    ]);
    entitlement.id = 'ent-1';

    expect(serializeEntity(Entitlement, entitlement)).toEqual({
      id: 'ent-1',
      organizationId: 'org-1',
      domains: ['product-configuration-management', 'stock-management'],
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const entitlement = await Effect.runPromise(
      deserializeSingleEntity(Entitlement, {
        id: 'ent-2',
        organizationId: 'org-2',
        domains: ['order-management'],
      }),
    );

    expect(entitlement?.domains).toEqual(['order-management']);
  });

  it('provisions nothing by default', () => {
    // A new organization buys its way in; it does not start with the fleet.
    expect(new Entitlement().domains).toEqual([]);
  });

  it('is queryable by organization, since it gates every role assignment', () => {
    const organizationId = describeEntityColumns(Entitlement).find(
      column => column.name === 'organizationId',
    );

    expect(organizationId?.filterable).toBe(true);
  });
});
