import { describe, expect, it } from 'vitest';

import type { Permission } from '../values/permission.js';
import { can, type GrantTable, permissionsOf } from './can.js';

/**
 * A grant table of this package's own.
 *
 * ⚠️ **Deliberately not r10c's.** This spec used to import `ROLE_PERMISSIONS`
 * and `CATALOG_DOMAIN`, which meant the framework's authorization test asserted
 * against one application's business rules — so a marketplace decision about
 * who may read a product could fail the framework's build, and the framework
 * could not be tested at all without that application present.
 */
const GRANTS: GrantTable = {
  reader: ['catalog:product:read'] as readonly Permission[],
  writer: ['catalog:product:read', 'catalog:product:write'],
  root: ['*:*:*'],
};

describe('permissionsOf', () => {
  it('expands a known role into its grants', () => {
    expect(permissionsOf(GRANTS, ['writer'])).toEqual(GRANTS.writer);
  });

  it('unions several roles', () => {
    expect(permissionsOf(GRANTS, ['reader', 'writer'])).toEqual([
      ...GRANTS.reader,
      ...GRANTS.writer,
    ]);
  });

  it('drops unrecognised roles instead of widening access', () => {
    expect(permissionsOf(GRANTS, ['nobody'])).toEqual([]);
  });
});

describe('can', () => {
  it('allows what a role grants', () => {
    expect(can(GRANTS, ['reader'], 'catalog:product:read')).toBe(true);
  });

  it('denies what no role grants', () => {
    expect(can(GRANTS, ['reader'], 'catalog:product:write')).toBe(false);
  });

  it('honours a wildcard grant', () => {
    expect(can(GRANTS, ['root'], 'anything:at:all')).toBe(true);
  });

  it('denies a principal with no roles', () => {
    expect(can(GRANTS, [], 'catalog:product:read')).toBe(false);
  });

  it('denies everything against an empty table', () => {
    expect(can({}, ['reader'], 'catalog:product:read')).toBe(false);
  });
});
