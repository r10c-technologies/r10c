import {
  type SessionScopeResolver,
  SessionScopeResolverTag,
} from '@r10c/business-ts-authn';
import type { PartyRoleName } from '@r10c/business-ts-party-management';
import { isPartyRoleName } from '@r10c/business-ts-party-management';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

/**
 * An account with no party record at all — a self-registered sign-up, which has
 * created no `Individual` yet. That is precisely a buyer, and `customer` is
 * also the safest thing to be wrong about: it is the population with the least
 * reach, and it holds no tenant scope.
 */
const DEFAULT_PARTY_ROLE: PartyRoleName = 'customer';

/**
 * Which organization-less role wins when a party holds more than one.
 *
 * ⚠️ **This is no longer the main rule, and the narrowing is the point of #76.**
 * A role is played in a context, so the role a session opens under is the one
 * played in the organization the session opened under. Precedence survives only
 * where there is no context to read: a party with no membership has nothing but
 * organization-less rows, and nothing in the session says which it meant.
 *
 * The residual that leaves, stated so it is not rediscovered as a bug: staff who
 * are also buyers still open an operator session, because `operator` and
 * `customer` are both organization-less. Closing that needs an explicit choice
 * at sign-in — a role switch, which re-mints the token through the path that
 * already exists — and it is not built.
 */
const PARTY_ROLE_PRECEDENCE: readonly PartyRoleName[] = [
  'operator',
  'vendor',
  'customer',
];

/** Every role this party holds, narrowed to the closed set. */
const rolesHeld = async (
  db: Db,
  partyId: unknown,
  organizationId: string | undefined,
): Promise<Set<PartyRoleName>> => {
  const docs = await db
    .collection('party-role')
    .find(
      organizationId === undefined
        ? // No context to read, so only the platform-wide rows are candidates.
          // `$in` rather than `$exists: false`, because a row written with an
          // explicit `null` is the same fact as a row without the member.
          { partyId, organizationId: { $in: [null, undefined] } }
        : { partyId, organizationId },
    )
    .toArray();

  // Narrowed rather than cast: the set is closed, and a document carrying
  // something outside it must not become a plane selector.
  return new Set(
    docs
      .map(doc => doc['role'])
      .filter((role): role is PartyRoleName => isPartyRoleName(role)),
  );
};

/**
 * Which role this session opens as.
 *
 * The role is a `PartyRole` **record**, not a column on the party: a party plays
 * many roles over time and several at once, which a single column could not
 * express (ADR 0022). The claim is one value and it selects a storage plane, so
 * a party holding several needs a rule — and the rule is the context.
 *
 * With an organization, the answer is the role played **there**. A party with a
 * membership but no role row in it falls back to the platform-wide rows rather
 * than to `customer` directly: holding `operator` and being a member of an
 * organization you have no vendor row in is a real shape, and answering
 * `customer` would silently narrow a session that should have been wider. The
 * direction to be wrong in is stated because both directions are wrong in some
 * way — narrowing silently is the failure nobody notices, widening is the one
 * that shows up immediately, and this path picks the second only when the first
 * would have invented a role the party does not hold.
 */
const resolvePartyRole = async (
  db: Db,
  partyId: unknown,
  organizationId: string | undefined,
): Promise<PartyRoleName> => {
  const inContext =
    organizationId === undefined
      ? new Set<PartyRoleName>()
      : await rolesHeld(db, partyId, organizationId);
  const held =
    inContext.size > 0 ? inContext : await rolesHeld(db, partyId, undefined);

  return (
    PARTY_ROLE_PRECEDENCE.find(role => held.has(role)) ?? DEFAULT_PARTY_ROLE
  );
};

export const makeMongoSessionScopeResolver = (
  db: Db,
): SessionScopeResolver => ({
  forUser: (userId: string) =>
    Effect.promise(async () => {
      const party = await db.collection('individual').findOne({ userId });
      if (party === null) {
        return { partyRole: DEFAULT_PARTY_ROLE, entitlements: [] };
      }

      // Narrowed rather than cast, for the reason every other field here is: a
      // document whose `id` is missing or of another type must not become an
      // identity a downstream read is scoped by.
      const partyId = typeof party['id'] === 'string' ? party['id'] : undefined;

      // ⚠️ **The membership is resolved first, and the role is read from it.**
      // A role is played in a context, so which organization the session opened
      // under is what decides which of a party's roles it opens as (#76). The
      // two lookups used to happen independently and never meet, which is how
      // "widest role anywhere" became the rule by default.
      const memberships = db.collection('membership');
      const preferred =
        (await memberships.findOne({
          partyId: party['id'],
          isDefault: true,
        })) ??
        // A membership exists but none is flagged default — take any rather
        // than stranding the member with no tenant scope at all.
        (await memberships.findOne({ partyId: party['id'] }));

      const organizationId = preferred?.['organizationId'];
      const partyRole = await resolvePartyRole(
        db,
        party['id'],
        typeof organizationId === 'string' ? organizationId : undefined,
      );

      if (typeof organizationId !== 'string') {
        // No membership, so no organization and nothing to be provisioned for.
        // The empty list is never consulted: `organizationId` being absent is
        // what tells every consumer the ceiling does not apply.
        return { partyId, partyRole, entitlements: [] };
      }

      // What the organization actually bought (ADR 0007). Read here rather than
      // per request because it changes on provisioning, which is rare, and a
      // lookup on the hot path is exactly what carrying it on the session
      // avoids. The cost is stated: a change is stale until the next sign-in.
      const entitlement = await db
        .collection('entitlement')
        .findOne({ organizationId });
      const domains = entitlement?.['domains'];

      return {
        organizationId,
        partyId,
        partyRole,
        // A row whose `domains` is missing or malformed reads as provisioned for
        // nothing rather than for everything: this is a ceiling, so the
        // direction to be wrong in is the narrow one.
        entitlements: Array.isArray(domains)
          ? domains.filter(
              (domain): domain is string => typeof domain === 'string',
            )
          : [],
      };
    }),
});

/** Control-plane lookup, so it rides on the service's own Mongo connection. */
export const SessionScopeResolverLayer = (db: Db) =>
  Layer.succeed(SessionScopeResolverTag, makeMongoSessionScopeResolver(db));
