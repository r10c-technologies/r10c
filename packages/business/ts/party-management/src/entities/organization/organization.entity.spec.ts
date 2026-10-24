import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Organization, OrganizationStatus } from './organization.entity.js';

const anOrganization = () => {
  const organization = new Organization('Acme Supplies', 'acme');
  organization.id = 'org-1';
  return organization;
};

describe('Organization', () => {
  it('serializes to a plain record with no tenant discriminator', () => {
    // The point of the whole tenancy model: an organization has no
    // `organizationId`, and neither does anything else. Isolation is which
    // database handle a request resolves to, so there is no column to forget.
    expect(serializeEntity(Organization, anOrganization())).toEqual({
      id: 'org-1',
      name: 'Acme Supplies',
      slug: 'acme',
      status: 'active',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const organization = await Effect.runPromise(
      deserializeSingleEntity(Organization, {
        id: 'org-2',
        name: 'Globex',
        slug: 'globex',
        status: 'suspended',
      }),
    );

    expect(organization?.name).toBe('Globex');
    expect(organization?.status).toBe(OrganizationStatus.Suspended);
  });

  it('defaults to active, so a freshly created tenant is usable', () => {
    expect(new Organization().status).toBe(OrganizationStatus.Active);
  });

  it('describes its columns with declared types', () => {
    expect(
      describeEntityColumns(Organization).map(column => [
        column.name,
        column.type,
      ]),
    ).toEqual([
      ['id', 'id'],
      ['name', 'string'],
      ['slug', 'string'],
      ['status', 'enum'],
      ['updatedAt', 'date'],
    ]);
  });

  it('holds the moment of its last write, which its announcement is stamped with', () => {
    const organization = new Organization('Demo Vendor', 'demo-vendor');
    expect(organization.updatedAt).toBeUndefined();

    organization.updatedAt = new Date('2026-10-23T10:00:00.000Z');
    expect(organization.updatedAt.toISOString()).toBe(
      '2026-10-23T10:00:00.000Z',
    );
  });

  it('allows querying by name, slug and status', () => {
    const filterable = describeEntityColumns(Organization)
      .filter(column => column.filterable)
      .map(column => column.name);

    // Not `id`: its type is `id`, which is not in the scalar set that
    // filtering defaults on for, and nothing here opts it back in.
    expect(filterable).toEqual(['name', 'slug', 'status']);
  });

  it('offers its lifecycle states as an enum rather than a free string', () => {
    const status = describeEntityColumns(Organization).find(
      column => column.name === 'status',
    );

    expect(status?.enumValues).toEqual(['active', 'suspended', 'archived']);
  });
});
