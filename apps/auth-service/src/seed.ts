import { MongoDatabaseTag } from '@entifix/mongo';
import {
  AccountRepositoryTag,
  ProviderDirectoryTag,
  provisionProviderHuman,
} from '@r10c/business-ts-authn';
import { seedOrganizations } from '@r10c/implementation-auth-mongo';
import {
  DEV_SEED_PASSWORD,
  type SeedShortfall,
} from '@r10c/shells-effect-auth';
import type { SeededVendor } from '@r10c/utils-ts-fleet';
import { Effect } from 'effect';

import {
  ALAN,
  entitlementSeedData,
  individualSeedData,
  operatorPartyRoleSeedData,
  organizationSeedData,
  secondMembershipSeedData,
  VENDOR_MEMBERS,
  vendorMemberSeedData,
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
 * Control-plane tenancy seed: every seeded vendor organization, the parties
 * behind the seeded accounts, each vendor's tenant role and the membership that
 * makes its member's sign-in resolve to it, and what each is provisioned for.
 *
 * These are control-plane records — they live in the shared database, not in a
 * tenant one. The organization record is precisely what makes a tenant handle
 * derivable, so it cannot itself live behind one.
 */
const seedTenancy = (vendors: readonly SeededVendor[]) =>
  Effect.all(
    [
      // Before the organizations: each announcement says whether that vendor
      // ships cash on delivery, which it reads off its entitlement (ADR 0070).
      seedCollection(
        'entitlement',
        vendors.flatMap(vendor => entitlementSeedData(vendor.organizationId)),
      ),
      // Through `writeOrganization`, never `seedCollection`: an organization's
      // write and its announcement share one transaction (ADR 0061).
      seedOrganizations(vendors.flatMap(organizationSeedData)),
      seedCollection('individual', individualSeedData),
      // Each vendor's member by position, then Ada's operator row.
      seedCollection('party-role', [
        ...membersOf(vendors).flatMap(
          ({ vendor, member }) =>
            vendorMemberSeedData(vendor.organizationId, member).partyRole,
        ),
        ...operatorPartyRoleSeedData,
        ...secondMembershipsOf(vendors).flatMap(
          ({ vendor, member }) =>
            secondMembershipSeedData(vendor.organizationId, member).partyRole,
        ),
      ]),
      seedCollection(
        'role',
        membersOf(vendors).flatMap(
          ({ vendor, member }) =>
            vendorMemberSeedData(vendor.organizationId, member).role,
        ),
      ),
      seedCollection('membership', [
        ...membersOf(vendors).flatMap(
          ({ vendor, member }) =>
            vendorMemberSeedData(vendor.organizationId, member).membership,
        ),
        ...secondMembershipsOf(vendors).flatMap(
          ({ vendor, member }) =>
            secondMembershipSeedData(vendor.organizationId, member).membership,
        ),
      ]),
    ],
    { discard: true },
  );

/**
 * Alan is also a member of the second seeded vendor, not by default, so a
 * live pass can switch organization (#527). Absent when the fleet seeds one
 * vendor only.
 */
const secondMembershipsOf = (vendors: readonly SeededVendor[]) => {
  const second = vendors[1];
  return second === undefined ? [] : [{ vendor: second, member: ALAN }];
};

/** Each seeded vendor beside the member who runs it, by position. */
const membersOf = (vendors: readonly SeededVendor[]) =>
  vendors.flatMap((vendor, index) => {
    const member = VENDOR_MEMBERS[index];
    return member === undefined ? [] : [{ vendor, member }];
  });

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
 * next boot repairs them, which is visible rather than silent: each account it
 * could not provision is answered as a shortfall, and the auth shell logs it.
 */
export const seedIdentityProvider = Effect.gen(function* () {
  const directory = yield* ProviderDirectoryTag;
  const accounts = yield* AccountRepositoryTag;
  const shortfalls: SeedShortfall[] = [];

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
        Effect.sync(() => {
          shortfalls.push({ record: { email }, failure });
        }),
      ),
    );
  }
  return shortfalls;
});

/**
 * The lab's seed, handed to the auth shell: the accounts and the demo
 * organization's tenancy, then a human at the identity provider for each
 * account, which links against the records the first step wrote.
 */
export const seedAuth = (vendors: readonly SeededVendor[]) =>
  Effect.all([seedUsers, seedTenancy(vendors)], {
    discard: true,
  }).pipe(Effect.andThen(seedIdentityProvider));
