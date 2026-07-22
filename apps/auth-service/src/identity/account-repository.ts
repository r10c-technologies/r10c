import { randomUUID } from 'node:crypto';

import {
  type AccountRepository,
  AuthnError,
  type CreateAccountInput,
  UserIdentity,
} from '@r10c/business-ts-authn';
import {
  deserializeSingleEntity,
  EntifixConnError,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/** Collections the credential flow reads and writes. */
export const USER_COLLECTION = 'user-identity';
export const IDENTIFIER_COLLECTION = 'entity-identifier';
export const CREDENTIAL_COLLECTION = 'user-credential';

/** Projection dropping Mongo's internal `_id`, matching the entity adapters. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;

/**
 * MongoDB-backed {@link AccountRepository}. Account creation spans three
 * collections and enforces identifier uniqueness, so it lives here as one
 * store-owned operation rather than in the use-case. Reads reuse the shared
 * entifix deserializer so a `UserIdentity` comes back with its identifier link
 * populated. Closures over `db` give every method `R = never`.
 */
export const makeMongoAccountRepository = (db: Db): AccountRepository => {
  const users = db.collection(USER_COLLECTION);
  const identifiers = db.collection(IDENTIFIER_COLLECTION);
  const credentials = db.collection(CREDENTIAL_COLLECTION);

  const fail = (message: string, error: unknown) =>
    new EntifixConnError(message, error);

  const findByIdentifier = (value: string) =>
    Effect.gen(function* () {
      const identifierDoc = yield* Effect.tryPromise({
        try: () => identifiers.findOne({ value }, WITHOUT_MONGO_ID),
        catch: (error) => fail('Failed to read identifier from MongoDB', error),
      });
      if (identifierDoc === null) {
        return null;
      }
      const userDoc = yield* Effect.tryPromise({
        try: () =>
          users.findOne({ id: identifierDoc['userId'] }, WITHOUT_MONGO_ID),
        catch: (error) => fail('Failed to read user from MongoDB', error),
      });
      const user = yield* deserializeSingleEntity(UserIdentity, userDoc);
      return (user as UserIdentity | undefined) ?? null;
    });

  const readPasswordHash = (userId: EntityId) =>
    Effect.gen(function* () {
      const doc = yield* Effect.tryPromise({
        try: () => credentials.findOne({ userId }, WITHOUT_MONGO_ID),
        catch: (error) => fail('Failed to read credential from MongoDB', error),
      });
      return (doc?.['passwordHash'] as string | undefined) ?? null;
    });

  const createAccount = (input: CreateAccountInput) =>
    Effect.gen(function* () {
      // Reject if any presented identifier value is already taken. An unverified
      // duplicate must never silently attach to an existing account.
      for (const identifier of input.identifiers) {
        const existing = yield* Effect.tryPromise({
          try: () => identifiers.findOne({ value: identifier.value }),
          catch: (error) =>
            fail('Failed to check identifier uniqueness in MongoDB', error),
        });
        if (existing !== null) {
          return yield* Effect.fail(
            new AuthnError('identifier already in use', undefined, {
              value: identifier.value,
            }),
          );
        }
      }

      const userId = randomUUID();
      const identifierDocs = input.identifiers.map((identifier) => ({
        id: randomUUID(),
        userId,
        type: identifier.type,
        value: identifier.value,
        verified: identifier.verified ?? false,
      }));
      const userDoc = {
        id: userId,
        displayName: input.displayName,
        status: 'active',
        identifiers: identifierDocs.map((doc) => doc.id),
      };

      // `insertMany` (even for a single doc) is the one insert form the shared
      // Mongo fake implements, so the same adapter runs in the hermetic e2e.
      yield* Effect.tryPromise({
        try: () => users.insertMany([{ ...userDoc }]),
        catch: (error) => fail('Failed to insert user into MongoDB', error),
      });
      yield* Effect.tryPromise({
        try: () => identifiers.insertMany(identifierDocs.map((doc) => ({ ...doc }))),
        catch: (error) => fail('Failed to insert identifiers into MongoDB', error),
      });
      yield* Effect.tryPromise({
        try: () =>
          credentials.insertMany([{ userId, passwordHash: input.passwordHash }]),
        catch: (error) => fail('Failed to insert credential into MongoDB', error),
      });

      const created = yield* deserializeSingleEntity(UserIdentity, userDoc);
      return created as UserIdentity;
    });

  return { findByIdentifier, readPasswordHash, createAccount };
};
