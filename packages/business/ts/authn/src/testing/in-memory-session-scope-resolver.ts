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

  return {
    forUser: userId =>
      Effect.sync((): SessionScope => {
        const party = world.individuals.find(one => one.userId === userId);
        if (party === undefined) {
          return { partyRole: 'customer', entitlements: [] };
        }
        const memberships = world.memberships.filter(
          one => one.partyId === party.id,
        );
        const organizationId = (
          memberships.find(one => one.isDefault === true) ?? memberships[0]
        )?.organizationId;
        const partyRole = roleOf(party.id, organizationId);
        if (organizationId === undefined) {
          return { partyId: party.id, partyRole, entitlements: [] };
        }
        return {
          organizationId,
          partyId: party.id,
          partyRole,
          entitlements: [
            ...(world.entitlements.find(
              one => one.organizationId === organizationId,
            )?.domains ?? []),
          ],
        };
      }),
  };
};
