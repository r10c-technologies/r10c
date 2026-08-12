import type { PartyRoleName } from '@r10c/business-ts-party-management';
import { isPartyRoleName } from '@r10c/business-ts-party-management';
import { Context, Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

/**
 * What a sign-in resolves about the party behind an account, beyond its
 * credentials: which population they belong to, and which organization (if any)
 * their session acts for.
 *
 * The two travel together because they come from the same party lookup, and
 * because they are the two halves of one question — *what may this session
 * reach* — answered before any permission is evaluated.
 */
export interface SessionScope {
  /**
   * The organization this session acts for, or `undefined` for a party holding
   * no membership. A normal answer, not a failure: only tenant-plane routes
   * care, and they answer `409 no-active-organization`.
   */
  readonly organizationId?: string;
  /**
   * Which population the party belongs to. Never inferred from the absence of
   * an organization — a buyer and an operator both lack one, and their reach
   * could hardly differ more.
   */
  readonly partyRole: PartyRoleName;
}

/**
 * Resolves the scope a sign-in should act in.
 *
 * The lookup is party → membership, not user → organization: a `UserIdentity`
 * is an account, an `Individual` is the person, and a `Membership` is that
 * person's participation in one organization. Keeping the hop explicit is what
 * lets an organization also be a party later without remodelling login.
 *
 * A party with several memberships resolves to the one flagged `isDefault`.
 */
export interface SessionScopeResolver {
  readonly forUser: (userId: string) => Effect.Effect<SessionScope>;
}

export class SessionScopeResolverTag extends Context.Tag(
  'SessionScopeResolverTag',
)<SessionScopeResolverTag, SessionScopeResolver>() {}

/**
 * An account with no party record at all — a self-registered sign-up, which has
 * created no `Individual` yet. That is precisely a buyer, and `customer` is
 * also the safest thing to be wrong about: it is the population with the least
 * reach, and it holds no tenant scope.
 */
const DEFAULT_PARTY_ROLE: PartyRoleName = 'customer';

/**
 * Which role wins when a party holds more than one, widest reach first.
 *
 * Deterministic and needing no extra input, at a cost worth stating: an operator
 * who is also a buyer always gets an operator session, so there is no way to act
 * as a buyer while being staff. Resolving the role from the membership the
 * session opened under is the better long-run answer and is deferred until
 * something needs it (ADR 0022).
 */
const PARTY_ROLE_PRECEDENCE: readonly PartyRoleName[] = [
  'operator',
  'vendor',
  'customer',
];

export const makeMongoSessionScopeResolver = (
  db: Db,
): SessionScopeResolver => ({
  forUser: (userId: string) =>
    Effect.promise(async () => {
      const party = await db.collection('individual').findOne({ userId });
      if (party === null) {
        return { partyRole: DEFAULT_PARTY_ROLE };
      }

      // The role is a `PartyRole` **record**, not a column on the party: a party
      // plays many roles over time and several at once, which a single column
      // could not express (ADR 0022).
      //
      // The claim is one value and it selects a storage plane, so a party
      // holding several needs a rule. Precedence by **reach** — the widest role
      // wins — because narrowing a session silently would be the failure nobody
      // notices, while widening it is the one that shows up immediately.
      //
      // Each stored role is narrowed rather than cast: the set is closed, and a
      // document carrying something outside it must not become a plane selector.
      const roleDocs = await db
        .collection('party-role')
        .find({ partyId: party['id'] })
        .toArray();
      const held = new Set(
        roleDocs
          .map(doc => doc['role'])
          .filter((role): role is PartyRoleName => isPartyRoleName(role)),
      );
      const partyRole =
        PARTY_ROLE_PRECEDENCE.find(role => held.has(role)) ??
        DEFAULT_PARTY_ROLE;

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
      return typeof organizationId === 'string'
        ? { organizationId, partyRole }
        : { partyRole };
    }),
});

/** Control-plane lookup, so it rides on the service's own Mongo connection. */
export const SessionScopeResolverLayer = (db: Db) =>
  Layer.succeed(SessionScopeResolverTag, makeMongoSessionScopeResolver(db));
