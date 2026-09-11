import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoSessionScopeResolver } from './session-scope';

type Doc = Record<string, unknown>;

/**
 * The smallest `Db` this resolver actually uses: four collections, `findOne` and
 * `find().toArray()`, and a filter matcher that understands the two shapes the
 * resolver builds.
 *
 * A fake rather than a live Mongo, because what is under test is the **order**
 * of two lookups and which row the second one selects — logic that a real
 * database would only obscure. The real connection is exercised by the fleet's
 * own boot, which is where a driver mistake would surface.
 */
const fakeDb = (collections: Record<string, readonly Doc[]>): Db => {
  const matches = (doc: Doc, filter: Doc): boolean =>
    Object.entries(filter).every(([field, expected]) => {
      const actual = doc[field];
      if (
        expected !== null &&
        typeof expected === 'object' &&
        '$in' in (expected as Doc)
      ) {
        const allowed = (expected as { $in: readonly unknown[] }).$in;
        // `undefined` and an absent member are the same fact here, which is
        // exactly what the resolver's `$in: [null, undefined]` is asserting.
        return allowed.some(value => value === actual);
      }
      return actual === expected;
    });

  const of = (name: string) => collections[name] ?? [];

  return {
    collection: (name: string) => ({
      findOne: (filter: Doc = {}) =>
        Promise.resolve(of(name).find(doc => matches(doc, filter)) ?? null),
      find: (filter: Doc = {}) => ({
        toArray: () =>
          Promise.resolve(of(name).filter(doc => matches(doc, filter))),
      }),
    }),
  } as unknown as Db;
};

const ORG = 'org-demo';

const resolve = (collections: Record<string, readonly Doc[]>, userId: string) =>
  Effect.runPromise(
    makeMongoSessionScopeResolver(fakeDb(collections)).forUser(userId),
  );

describe('makeMongoSessionScopeResolver', () => {
  it('opens as the role played in the organization the session opened under', async () => {
    const scope = await resolve(
      {
        individual: [{ id: 'party-1', userId: 'user-1' }],
        membership: [
          { partyId: 'party-1', organizationId: ORG, isDefault: true },
        ],
        'party-role': [
          { partyId: 'party-1', role: 'vendor', organizationId: ORG },
        ],
        entitlement: [{ organizationId: ORG, domains: ['catalog'] }],
      },
      'user-1',
    );

    expect(scope).toEqual({
      organizationId: ORG,
      partyId: 'party-1',
      partyRole: 'vendor',
      entitlements: ['catalog'],
    });
  });

  it('lets the context win over the wider role the party also holds', async () => {
    // The whole point of #76. Under precedence by reach this answered
    // `operator`, and a party who is staff somewhere could never open a vendor
    // session for the organization they actually sell for.
    const scope = await resolve(
      {
        individual: [{ id: 'party-1', userId: 'user-1' }],
        membership: [
          { partyId: 'party-1', organizationId: ORG, isDefault: true },
        ],
        'party-role': [
          { partyId: 'party-1', role: 'operator' },
          { partyId: 'party-1', role: 'vendor', organizationId: ORG },
        ],
      },
      'user-1',
    );

    expect(scope.partyRole).toBe('vendor');
  });

  it('reads the platform-wide roles when there is no membership at all', async () => {
    // Platform staff are deliberately members of nothing, so an operator's row
    // carries no organization and there is no context to read.
    const scope = await resolve(
      {
        individual: [{ id: 'party-2', userId: 'user-2' }],
        'party-role': [{ partyId: 'party-2', role: 'operator' }],
      },
      'user-2',
    );

    expect(scope).toEqual({
      partyId: 'party-2',
      partyRole: 'operator',
      entitlements: [],
    });
  });

  it('still picks by reach among the organization-less rows, which is the residual', async () => {
    // Staff who are also buyers: nothing in the session says which they meant,
    // so the widest wins and an operator session is what they get. Closing this
    // needs an explicit role switch at sign-in, which is not built.
    const scope = await resolve(
      {
        individual: [{ id: 'party-2', userId: 'user-2' }],
        'party-role': [
          { partyId: 'party-2', role: 'customer' },
          { partyId: 'party-2', role: 'operator' },
        ],
      },
      'user-2',
    );

    expect(scope.partyRole).toBe('operator');
  });

  it('falls back to the platform-wide role rather than inventing a customer', async () => {
    // A member of an organization they hold no role in. Answering `customer`
    // would silently narrow a session that should have stayed an operator's.
    const scope = await resolve(
      {
        individual: [{ id: 'party-3', userId: 'user-3' }],
        membership: [{ partyId: 'party-3', organizationId: ORG }],
        'party-role': [{ partyId: 'party-3', role: 'operator' }],
      },
      'user-3',
    );

    expect(scope.partyRole).toBe('operator');
    expect(scope.organizationId).toBe(ORG);
  });

  it('ignores another organization’s role for this party', async () => {
    const scope = await resolve(
      {
        individual: [{ id: 'party-4', userId: 'user-4' }],
        membership: [
          { partyId: 'party-4', organizationId: ORG, isDefault: true },
        ],
        'party-role': [
          { partyId: 'party-4', role: 'vendor', organizationId: 'org-other' },
        ],
      },
      'user-4',
    );

    expect(scope.partyRole).toBe('customer');
  });

  it('takes any membership when none is flagged default', async () => {
    const scope = await resolve(
      {
        individual: [{ id: 'party-5', userId: 'user-5' }],
        membership: [{ partyId: 'party-5', organizationId: ORG }],
        'party-role': [
          { partyId: 'party-5', role: 'vendor', organizationId: ORG },
        ],
      },
      'user-5',
    );

    expect(scope.organizationId).toBe(ORG);
    expect(scope.partyRole).toBe('vendor');
  });

  it('refuses a stored role outside the closed set', async () => {
    // The set is also the plane selector, so a document carrying something
    // outside it must not become one.
    const scope = await resolve(
      {
        individual: [{ id: 'party-6', userId: 'user-6' }],
        'party-role': [{ partyId: 'party-6', role: 'superuser' }],
      },
      'user-6',
    );

    expect(scope.partyRole).toBe('customer');
  });

  it('answers customer for a user with no party at all', async () => {
    const scope = await resolve({ individual: [] }, 'user-nobody');

    expect(scope).toEqual({ partyRole: 'customer', entitlements: [] });
  });

  it('reads an unprovisioned organization as entitled to nothing', async () => {
    // A ceiling, so the direction to be wrong in is the narrow one.
    const scope = await resolve(
      {
        individual: [{ id: 'party-7', userId: 'user-7' }],
        membership: [
          { partyId: 'party-7', organizationId: ORG, isDefault: true },
        ],
        entitlement: [{ organizationId: ORG, domains: 'not-a-list' }],
      },
      'user-7',
    );

    expect(scope.entitlements).toEqual([]);
  });
});
