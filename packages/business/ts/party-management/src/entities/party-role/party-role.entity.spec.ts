import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PartyRole } from './party-role.entity.js';

describe('PartyRole', () => {
  it('serializes the party and the role it plays', () => {
    const partyRole = new PartyRole('party-1', 'vendor');
    partyRole.id = 'role-1';

    expect(serializeEntity(PartyRole, partyRole)).toEqual({
      id: 'role-1',
      partyId: 'party-1',
      role: 'vendor',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const partyRole = await Effect.runPromise(
      deserializeSingleEntity(PartyRole, {
        id: 'role-2',
        partyId: 'party-2',
        role: 'operator',
      }),
    );

    expect(partyRole?.partyId).toBe('party-2');
    expect(partyRole?.role).toBe('operator');
  });

  it('defaults to `customer`, the population with the least reach', () => {
    // The safest thing to be wrong about: a buyer holds no tenant scope, so an
    // unresolved role can never widen a session.
    const partyRole = new PartyRole();

    expect(partyRole.partyId).toBe('');
    expect(partyRole.role).toBe('customer');
  });

  it('accepts the setters a repository writes back through', () => {
    const partyRole = new PartyRole();
    partyRole.partyId = 'party-3';
    partyRole.role = 'vendor';

    expect(partyRole.partyId).toBe('party-3');
    expect(partyRole.role).toBe('vendor');
  });

  it('lets one party hold several roles, which is the whole point', () => {
    // The case a column on `Individual` could not express, and the reason SID
    // models `PartyRole` as an entity: a vendor here that is a customer
    // somewhere else.
    const asVendor = new PartyRole('party-4', 'vendor');
    const asCustomer = new PartyRole('party-4', 'customer');

    expect(asVendor.partyId).toBe(asCustomer.partyId);
    expect(asVendor.role).not.toBe(asCustomer.role);
  });

  it('makes "every role this party holds" a first-class query', () => {
    // That query is what resolves a session, so it has to be expressible —
    // member metadata is also the server-side filter allowlist.
    const partyId = describeEntityColumns(PartyRole).find(
      column => column.name === 'partyId',
    );

    expect(partyId?.filterable).toBe(true);
  });

  it('carries the organization a role is played in, when there is one', () => {
    const partyRole = new PartyRole('party-3', 'vendor');
    partyRole.id = 'role-3';
    partyRole.organizationId = 'org-demo';

    expect(serializeEntity(PartyRole, partyRole)).toEqual({
      id: 'role-3',
      partyId: 'party-3',
      role: 'vendor',
      organizationId: 'org-demo',
    });
    expect(partyRole.organizationId).toBe('org-demo');
  });

  it('leaves a platform-wide role without one', () => {
    // Absent means "played on the platform", not "not filled in". An operator
    // holds no tenant scope by decision, and a customer belongs to no
    // organization — so neither has one to name.
    const partyRole = new PartyRole('party-4', 'operator');

    expect(partyRole.organizationId).toBeUndefined();
    partyRole.organizationId = undefined;
    expect(partyRole.organizationId).toBeUndefined();
  });

  it('makes "this party’s role in this organization" a first-class query', () => {
    // The lookup that replaced precedence by reach (#76). Without the flag the
    // resolver would read every role the party holds anywhere and narrow it in
    // memory, which is the shape the old rule had.
    const organizationId = describeEntityColumns(PartyRole).find(
      column => column.name === 'organizationId',
    );

    expect(organizationId?.filterable).toBe(true);
  });

  it('offers the role as a closed set, so it renders and filters', () => {
    // Declared `enum` rather than `string`: the raw `vendor` token would
    // otherwise reach the user untranslated, and the value set is also the
    // plane selector — a storage boundary must not be a free-form string.
    const role = describeEntityColumns(PartyRole).find(
      column => column.name === 'role',
    );

    expect(role?.type).toBe('enum');
    expect(role?.enumValues).toEqual(['customer', 'vendor', 'operator']);
    expect(role?.filterable).toBe(true);
  });
});
