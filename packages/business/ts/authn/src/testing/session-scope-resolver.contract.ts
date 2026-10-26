import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SessionScopeResolver } from '../repository/session-stores';

/**
 * The party records a resolver reads, as the party and access domains write
 * them. A role row with no `organizationId` is held platform-wide.
 */
export interface PartyWorld {
  readonly individuals: ReadonlyArray<{ id: string; userId: string }>;
  readonly memberships: ReadonlyArray<{
    partyId: string;
    organizationId: string;
    isDefault?: boolean;
  }>;
  readonly roles: ReadonlyArray<{
    partyId: string;
    role: string;
    organizationId?: string;
  }>;
  readonly entitlements: ReadonlyArray<{
    organizationId: string;
    domains: readonly string[];
  }>;
}

const EMPTY: PartyWorld = {
  individuals: [],
  memberships: [],
  roles: [],
  entitlements: [],
};

/**
 * What every {@link SessionScopeResolver} must guarantee, which is what a
 * session opens as:
 * - the default membership's organization, or the first membership's when
 *   none is the default;
 * - the role played there, falling back to roles held platform-wide;
 * - `operator` over `vendor` over `customer`, and `customer` for anyone with
 *   no role or no party at all;
 * - that organization's entitlements, and none without an organization.
 *
 * `make(world)` returns a resolver reading `world`.
 */
export const describeSessionScopeResolverContract = (
  name: string,
  make: (world: PartyWorld) => SessionScopeResolver | Promise<SessionScopeResolver>,
) => {
  describe(`${name} honours the SessionScopeResolver contract`, () => {
    const scopeOf = async (world: Partial<PartyWorld>, userId = 'u-1') =>
      Effect.runPromise(
        (await make({ ...EMPTY, ...world })).forUser(userId),
      );
    const party = { individuals: [{ id: 'p-1', userId: 'u-1' }] };

    it('opens a user with no party as a customer of nothing', async () => {
      expect(await scopeOf({})).toEqual({
        partyRole: 'customer',
        entitlements: [],
      });
    });

    it("opens in the default membership's organization, as the role played there", async () => {
      expect(
        await scopeOf({
          ...party,
          memberships: [
            { partyId: 'p-1', organizationId: 'org-a' },
            { partyId: 'p-1', organizationId: 'org-b', isDefault: true },
          ],
          roles: [
            { partyId: 'p-1', role: 'customer', organizationId: 'org-a' },
            { partyId: 'p-1', role: 'vendor', organizationId: 'org-b' },
          ],
          entitlements: [{ organizationId: 'org-b', domains: ['catalog'] }],
        }),
      ).toEqual({
        organizationId: 'org-b',
        partyId: 'p-1',
        partyRole: 'vendor',
        entitlements: ['catalog'],
      });
    });

    it('falls back to the first membership, and to a role held platform-wide', async () => {
      expect(
        await scopeOf({
          ...party,
          memberships: [{ partyId: 'p-1', organizationId: 'org-a' }],
          roles: [{ partyId: 'p-1', role: 'operator' }],
        }),
      ).toEqual({
        organizationId: 'org-a',
        partyId: 'p-1',
        partyRole: 'operator',
        entitlements: [],
      });
    });

    it('prefers operator over vendor over customer', async () => {
      const held = (roles: string[]) =>
        scopeOf({
          ...party,
          roles: roles.map(role => ({ partyId: 'p-1', role })),
        });

      expect((await held(['customer', 'vendor', 'operator'])).partyRole).toBe(
        'operator',
      );
      expect((await held(['customer', 'vendor'])).partyRole).toBe('vendor');
      expect((await held(['not-a-role'])).partyRole).toBe('customer');
    });

    it('opens a party with no membership in no organization', async () => {
      expect(
        await scopeOf({
          ...party,
          roles: [{ partyId: 'p-1', role: 'vendor', organizationId: 'org-a' }],
        }),
      ).toEqual({ partyId: 'p-1', partyRole: 'customer', entitlements: [] });
    });
  });
};
