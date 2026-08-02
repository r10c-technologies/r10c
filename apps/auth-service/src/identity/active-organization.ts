import { Context, Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

/**
 * Resolves which organization a sign-in should act for.
 *
 * The lookup is party → membership, not user → organization: a `UserIdentity`
 * is an account, an `Individual` is the person, and a `Membership` is that
 * person's participation in one organization. Keeping the hop explicit is what
 * lets an organization also be a party later without remodelling login.
 *
 * A party with several memberships resolves to the one flagged `isDefault`, and
 * a party with none resolves to `undefined` — a buyer or an operator, neither of
 * which holds tenant scope. `undefined` is a normal answer here, not a failure:
 * only tenant-plane routes care, and they answer `409 no-active-organization`.
 */
export interface ActiveOrganizationResolver {
  readonly forUser: (userId: string) => Effect.Effect<string | undefined>;
}

export class ActiveOrganizationResolverTag extends Context.Tag(
  'ActiveOrganizationResolverTag',
)<ActiveOrganizationResolverTag, ActiveOrganizationResolver>() {}

export const makeMongoActiveOrganizationResolver = (
  db: Db,
): ActiveOrganizationResolver => ({
  forUser: (userId: string) =>
    Effect.promise(async () => {
      const party = await db.collection('individual').findOne({ userId });
      if (party === null) {
        return undefined;
      }

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
      return typeof organizationId === 'string' ? organizationId : undefined;
    }),
});

/** Control-plane lookup, so it rides on the service's own Mongo connection. */
export const ActiveOrganizationResolverLayer = (db: Db) =>
  Layer.succeed(
    ActiveOrganizationResolverTag,
    makeMongoActiveOrganizationResolver(db),
  );
