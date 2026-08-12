import { randomUUID } from 'node:crypto';

import {
  type AccountRepository,
  AuthnError,
  type CreateAccountInput,
  IdentifierType,
  type IdentityProjection,
  type UpdateUserAspects,
  UserIdentity,
} from '@r10c/business-ts-authn';
import {
  deserializeSingleEntity,
  EntifixConnError,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db, Document, PushOperator } from 'mongodb';

/**
 * Collections the account flow reads and writes.
 *
 * There is no credential collection any more, and that absence is the point:
 * Zitadel holds every secret, so a dump of this database yields nothing that
 * can be used to sign in as anyone.
 */
export const USER_COLLECTION = 'user-identity';
export const IDENTIFIER_COLLECTION = 'entity-identifier';

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

  const fail = (message: string, error: unknown) =>
    new EntifixConnError(message, error);

  const findByIdentifier = (value: string) =>
    Effect.gen(function* () {
      const identifierDoc = yield* Effect.tryPromise({
        try: () => identifiers.findOne({ value }, WITHOUT_MONGO_ID),
        catch: error => fail('Failed to read identifier from MongoDB', error),
      });
      if (identifierDoc === null) {
        return null;
      }
      const userDoc = yield* Effect.tryPromise({
        try: () =>
          users.findOne({ id: identifierDoc['userId'] }, WITHOUT_MONGO_ID),
        catch: error => fail('Failed to read user from MongoDB', error),
      });
      const user = yield* deserializeSingleEntity(UserIdentity, userDoc);
      return (user as UserIdentity | undefined) ?? null;
    });

  const findById = (userId: EntityId) =>
    Effect.gen(function* () {
      const userDoc = yield* Effect.tryPromise({
        try: () => users.findOne({ id: userId }, WITHOUT_MONGO_ID),
        catch: error => fail('Failed to read user from MongoDB', error),
      });
      const user = yield* deserializeSingleEntity(UserIdentity, userDoc);
      return (user as UserIdentity | undefined) ?? null;
    });

  const updateUserAspects = (userId: EntityId, changes: UpdateUserAspects) =>
    Effect.gen(function* () {
      // Only the aspects that were actually supplied are written, so a partial
      // PATCH never blanks the member it left out.
      const update: Record<string, unknown> = {};
      if (changes.role !== undefined) {
        update['role'] = changes.role;
      }
      if (changes.status !== undefined) {
        update['status'] = changes.status;
      }

      yield* Effect.tryPromise({
        try: () => users.updateOne({ id: userId }, { $set: update }),
        catch: error => fail('Failed to update user in MongoDB', error),
      });

      const updated = yield* findById(userId);
      if (updated === null) {
        return yield* Effect.fail(
          new AuthnError('user not found', undefined, { userId }),
        );
      }
      return updated;
    });

  const findContactAddress = (userId: EntityId) =>
    Effect.gen(function* () {
      const doc = yield* Effect.tryPromise({
        try: () =>
          identifiers.findOne({ userId, type: 'email' }, WITHOUT_MONGO_ID),
        catch: error => fail('Failed to read identifier from MongoDB', error),
      });
      return (doc?.['value'] as string | undefined) ?? null;
    });

  /**
   * Add an identifier row and point the user's link collection at it.
   *
   * Both halves, because `user-identity.identifiers` is a foreign-key array:
   * writing only the identifier document would leave a row nothing links to,
   * and the user would come back from `deserializeSingleEntity` without it.
   */
  /**
   * Point the user's link collection at an identifier id.
   *
   * `$addToSet`, not `$push`, and separated from the insert so it can be called
   * on its own. The boot seed rewrites `user-identity` with `$set` on every
   * start, which resets `identifiers` to the literal seed array — so a link
   * added by provisioning on one boot is gone by the next one, leaving an
   * identifier row nothing points at. Re-asserting the link on every
   * provisioning run is what repairs that, and `$addToSet` is what keeps the
   * repair from accumulating duplicates.
   */
  const linkIdentifier = (userId: EntityId, identifierId: string) =>
    Effect.tryPromise({
      try: () =>
        users.updateOne(
          { id: userId },
          {
            // The driver types this against an untyped `Document`, which loses
            // the element type of a string array. The cast is at the driver
            // seam only; the value added is the identifier id the entity's link
            // collection is built from.
            $addToSet: {
              identifiers: identifierId,
            } as unknown as PushOperator<Document>,
          },
        ),
      catch: error => fail('Failed to link identifier in MongoDB', error),
    }).pipe(Effect.asVoid);

  /**
   * Add an identifier row and point the user's link collection at it.
   *
   * Both halves, because `user-identity.identifiers` is a foreign-key array:
   * writing only the identifier document would leave a row nothing links to,
   * and the user would come back from `deserializeSingleEntity` without it.
   */
  const attachIdentifier = (userId: EntityId, doc: Record<string, unknown>) =>
    Effect.gen(function* () {
      const identifierId = randomUUID();
      yield* Effect.tryPromise({
        try: () =>
          identifiers.insertMany([{ id: identifierId, userId, ...doc }]),
        catch: error => fail('Failed to insert identifier into MongoDB', error),
      });
      yield* linkIdentifier(userId, identifierId);
    });

  const linkExternalSubject = (
    userId: EntityId,
    subject: string,
    provider: string,
  ) =>
    Effect.gen(function* () {
      const existing = yield* Effect.tryPromise({
        try: () =>
          identifiers.findOne(
            { userId, type: IdentifierType.ExternalSubject },
            WITHOUT_MONGO_ID,
          ),
        catch: error => fail('Failed to read identifier from MongoDB', error),
      });

      // Re-linking is how provisioning repairs itself: a run that created the
      // local record but died before Zitadel answered leaves no subject, and
      // the next attempt writes one. An account may hold only one, so a
      // different subject overwrites rather than accumulating.
      if (existing !== null) {
        yield* Effect.tryPromise({
          try: () =>
            identifiers.updateOne(
              { id: existing['id'] },
              { $set: { value: subject, provider, verified: true } },
            ),
          catch: error => fail('Failed to update identifier in MongoDB', error),
        });
        // Re-asserted, not assumed: the boot seed's `$set` on `user-identity`
        // wipes the link array back to the seed literal, so the row would
        // otherwise survive with nothing pointing at it.
        yield* linkIdentifier(userId, String(existing['id']));
        return;
      }

      yield* attachIdentifier(userId, {
        type: IdentifierType.ExternalSubject,
        value: subject,
        provider,
        verified: true,
      });
    });

  const projectIdentity = (userId: EntityId, projection: IdentityProjection) =>
    Effect.gen(function* () {
      if (projection.displayName !== undefined) {
        yield* Effect.tryPromise({
          try: () =>
            users.updateOne(
              { id: userId },
              { $set: { displayName: projection.displayName } },
            ),
          catch: error => fail('Failed to update user in MongoDB', error),
        });
      }

      if (projection.email === undefined) return;

      const current = yield* Effect.tryPromise({
        try: () =>
          identifiers.findOne(
            { userId, type: IdentifierType.Email },
            WITHOUT_MONGO_ID,
          ),
        catch: error => fail('Failed to read identifier from MongoDB', error),
      });

      if (current === null) {
        yield* attachIdentifier(userId, {
          type: IdentifierType.Email,
          value: projection.email,
          verified: projection.emailVerified,
        });
        return;
      }

      yield* Effect.tryPromise({
        try: () =>
          identifiers.updateOne(
            { id: current['id'] },
            {
              $set: {
                value: projection.email,
                verified: projection.emailVerified,
              },
            },
          ),
        catch: error => fail('Failed to update identifier in MongoDB', error),
      });
    });

  const createAccount = (input: CreateAccountInput) =>
    Effect.gen(function* () {
      // Reject if any presented identifier value is already taken. An unverified
      // duplicate must never silently attach to an existing account.
      for (const identifier of input.identifiers) {
        const existing = yield* Effect.tryPromise({
          try: () => identifiers.findOne({ value: identifier.value }),
          catch: error =>
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
      const identifierDocs = input.identifiers.map(identifier => ({
        id: randomUUID(),
        userId,
        type: identifier.type,
        value: identifier.value,
        verified: identifier.verified ?? false,
        // Absent for a local identifier, and written for a federated one so an
        // `external-subject` row always says which provider minted it.
        ...(identifier.provider === undefined
          ? {}
          : { provider: identifier.provider }),
      }));
      const userDoc = {
        id: userId,
        displayName: input.displayName,
        status: 'active',
        role: input.role,
        identifiers: identifierDocs.map(doc => doc.id),
      };

      // `insertMany` (even for a single doc) is the one insert form the shared
      // Mongo fake implements, so the same adapter runs in the hermetic e2e.
      yield* Effect.tryPromise({
        try: () => users.insertMany([{ ...userDoc }]),
        catch: error => fail('Failed to insert user into MongoDB', error),
      });
      yield* Effect.tryPromise({
        try: () =>
          identifiers.insertMany(identifierDocs.map(doc => ({ ...doc }))),
        catch: error =>
          fail('Failed to insert identifiers into MongoDB', error),
      });

      const created = yield* deserializeSingleEntity(UserIdentity, userDoc);
      return created as UserIdentity;
    });

  return {
    findByIdentifier,
    findById,
    findContactAddress,
    linkExternalSubject,
    projectIdentity,
    createAccount,
    updateUserAspects,
  };
};
