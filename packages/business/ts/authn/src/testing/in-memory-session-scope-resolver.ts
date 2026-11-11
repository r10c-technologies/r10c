import { Effect } from 'effect';

import type {
  SessionScope,
  SessionScopeResolver,
} from '../repository/session-stores';
import type { PartyWorld } from './session-scope-resolver.contract';

const PRECEDENCE = ['operator', 'vendor', 'customer'] as const;

/**
 * A {@link SessionScopeResolver} over a {@link PartyWorld} held in memory, for
 * the specs of whatever opens a session. It runs
 * `describeSessionScopeResolverContract`, so it picks the organization and the
 * role by the same rules as the Mongo resolver.
 */
export const makeInMemorySessionScopeResolver = (
  world: PartyWorld,
): SessionScopeResolver => {
  const roleOf = (partyId: string, organizationId: string | undefined) => {
    const held = (inOrganization: string | undefined) =>
      world.roles
        .filter(
          one =>
            one.partyId === partyId && one.organizationId === inOrganization,
        )
        .map(one => one.role);
    const inContext = organizationId === undefined ? [] : held(organizationId);
    const roles = inContext.length > 0 ? inContext : held(undefined);
    return PRECEDENCE.find(role => roles.includes(role)) ?? 'customer';
  };

  const partyOf = (userId: string) =>
    world.individuals.find(one => one.userId === userId);
  const membershipsOf = (partyId: string) =>
    [...world.memberships.filter(one => one.partyId === partyId)].sort(
      (left, right) =>
        Number(right.isDefault === true) - Number(left.isDefault === true),
    );

  const scopeIn = (
    partyId: string,
    organizationId: string | undefined,
  ): SessionScope => {
    const partyRole = roleOf(partyId, organizationId);
    if (organizationId === undefined) {
      return { partyId, partyRole, entitlements: [] };
    }
    return {
      organizationId,
      partyId,
      partyRole,
      entitlements: [
        ...(world.entitlements.find(
          one => one.organizationId === organizationId,
        )?.domains ?? []),
      ],
    };
  };

  return {
    forUser: userId =>
      Effect.sync((): SessionScope => {
        const party = partyOf(userId);
        if (party === undefined) {
          return { partyRole: 'customer', entitlements: [] };
        }
        return scopeIn(party.id, membershipsOf(party.id)[0]?.organizationId);
      }),
    forMembership: (userId, organizationId) =>
      Effect.sync(() => {
        const party = partyOf(userId);
        if (party === undefined) return undefined;
        return membershipsOf(party.id).some(
          one => one.organizationId === organizationId,
        )
          ? scopeIn(party.id, organizationId)
          : undefined;
      }),
    membershipsOf: userId =>
      Effect.sync(() => {
        const party = partyOf(userId);
        if (party === undefined) return [];
        return membershipsOf(party.id).map(one => {
          const name = world.organizations.find(
            organization => organization.id === one.organizationId,
          )?.name;
          return {
            organizationId: one.organizationId,
            ...(name === undefined ? {} : { name }),
            isDefault: one.isDefault === true,
          };
        });
      }),
  };
};
