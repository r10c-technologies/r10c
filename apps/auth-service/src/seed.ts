import { MongoDatabaseTag } from '@entifix/mongo';
import {
  AccountRepositoryTag,
  ProviderDirectoryTag,
  provisionProviderHuman,
} from '@r10c/business-ts-authn';
import { seedOrganizations } from '@r10c/implementation-auth-mongo';
import { DEV_SEED_PASSWORD } from '@r10c/shells-effect-auth';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import {
  entitlementSeedData,
  individualSeedData,
  membershipSeedData,
  organizationSeedData,
  partyRoleSeedData,
  roleSeedData,
} from './identity/tenancy-seed-data';
import {
  entityIdentifierSeedData,
  userIdentitySeedData,
} from './identity/user-seed-data';

/**
 * Reconciles seed docs one at a time: insert what is missing, and bring what is
 * already there back in line with the seed.
 *
 * Per-document rather than "insert only when the collection is empty", because
 * an empty-collection guard silently skips a store seeded by an earlier version
 * of the seed — which is exactly how a long-lived dev database ended up with
 * users that predate the `role` aspect and so logged in as `user` regardless of
 * the tier they were supposed to have.
 */
function seedCollection(
  collectionName: string,
  data: ReadonlyArray<Record<string, unknown>>,
) {
  return Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const collection = db.collection(collectionName);
    for (const item of data) {
      const existing = yield* Effect.promise(() =>
        collection.findOne({ id: item['id'] }),
      );
      if (existing === null) {
        yield* Effect.promise(() => collection.insertMany([{ ...item }]));
      } else {
        yield* Effect.promise(() =>
          collection.updateOne({ id: item['id'] }, { $set: { ...item } }),
        );
      }
    }
  });
}

const seedUsers = Effect.all(
  [
    seedCollection('user-identity', userIdentitySeedData),
    seedCollection('entity-identifier', entityIdentifierSeedData),
  ],
  { discard: true },
);

/**
 * Control-plane tenancy seed: the demo organization, the parties behind the
 * seeded accounts, one tenant role, the membership that makes a sign-in resolve
 * to an organization, and what that organization is provisioned for.
 *
 * These are control-plane records — they live in the shared database, not in a
 * tenant one. The organization record is precisely what makes a tenant handle
 * derivable, so it cannot itself live behind one.
 */
const seedTenancy = (organizationId: string) =>
  Effect.all(
    [
      // Through `writeOrganization`, never `seedCollection`: an organization's
      // write and its announcement share one transaction (ADR 0061).
      seedOrganizations(organizationSeedData(organizationId)),
      seedCollection('individual', individualSeedData),
      seedCollection('party-role', partyRoleSeedData(organizationId)),
      seedCollection('role', roleSeedData(organizationId)),
      seedCollection('membership', membershipSeedData(organizationId)),
      seedCollection('entitlement', entitlementSeedData(organizationId)),
    ],
    { discard: true },
  );

/**
 * Give each seeded user a human at the identity provider to sign in as, and
 * link the two.
 *
 * This is the same `provisionProviderHuman` the administrative create route
 * runs — deliberately, because a seeding path that wrote its own accounts is a
 * second provisioning implementation to keep correct, and it is exactly the
 * kind that drifts unnoticed. Idempotent by lookup, so a boot against an
 * already-seeded instance adopts what is there and only repairs a missing link.
 *
 * Best-effort as a whole: a provider that is not up yet must not stop the
 * service from booting. The seeded accounts simply cannot sign in until the
 * next boot repairs them, which is visible rather than silent.
 */
export const seedIdentityProvider = Effect.gen(function* () {
  const directory = yield* ProviderDirectoryTag;
  const accounts = yield* AccountRepositoryTag;

  for (const user of userIdentitySeedData) {
    const userId = String(user['id']);
    const email = entityIdentifierSeedData.find(
      identifier =>
        identifier['userId'] === userId && identifier['type'] === 'email',
    )?.['value'];
    if (typeof email !== 'string') continue;

    yield* provisionProviderHuman(accounts, directory, {
      userId,
      email,
      displayName: user['displayName'] as string | undefined,
      password: DEV_SEED_PASSWORD,
    }).pipe(
      Effect.catch(failure =>
        logSliceOutcome(
          'Warn',
          'could not provision a seeded user at the identity provider',
          { email },
          failure,
        ),
      ),
    );
  }
});

/**
 * The lab's seed, handed to the auth shell: the accounts and the demo
 * organization's tenancy, then a human at the identity provider for each
 * account, which links against the records the first step wrote.
 */
export const seedAuth = (organizationId: string) =>
  Effect.all([seedUsers, seedTenancy(organizationId)], {
    discard: true,
  }).pipe(Effect.andThen(seedIdentityProvider));
