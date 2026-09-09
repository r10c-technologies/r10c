import type { InboxClaim, TransactionInbox } from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/**
 * The inbox collection, and it lives in **whichever database the side effect it
 * guards writes to** — not in one central place.
 *
 * That is the whole mechanism, not a deployment preference: a claim is only
 * worth anything if it commits in the same storage transaction as the effect,
 * and two databases cannot be one transaction. So the saga tracker's inbox is in
 * the `saga` database because its fold writes there, exactly as the outbox is
 * per-tenant because the entity is.
 */
export const INBOX_COLLECTION = 'transaction_inbox';

/** Mongo's duplicate-key error, which is how a redelivery is recognised. */
const DUPLICATE_KEY = 11000;

export const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/**
 * The stored shape of a claim.
 *
 * Exported for the same reason `outboxDocument` is: the claim that matters is
 * **not** written through the port. It has to join the side effect's session to
 * be atomic with it, and a session cannot live in a framework-free contract, so
 * the consumer inserts this document itself. {@link makeMongoInbox} is for a
 * consumer that can claim standalone.
 */
export const inboxDocument = (
  consumer: string,
  eventId: string,
): InboxClaim => ({
  consumer,
  eventId,
  claimedAt: new Date().toISOString(),
});

/**
 * The unique index the claim rides, on **`(consumer, eventId)`**.
 *
 * Compound, and that is the half easy to get wrong. Two consumers legitimately
 * process the same event — the tracker's fold and the SSE hub both bind
 * `transaction.*` — so a unique index on `eventId` alone would let whichever
 * claimed first starve every other consumer of every message, while the broker,
 * the queue and the handler all went on reporting success.
 *
 * Called per handle rather than once at boot, matching `ensureOutboxIndexes`:
 * the index must exist before the first claim, not eventually, or two
 * concurrent first deliveries both insert.
 */
export const ensureInboxIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection<InboxClaim>(INBOX_COLLECTION)
        .createIndex({ consumer: 1, eventId: 1 }, { unique: true });
    },
    catch: error =>
      new EntifixConnError('Failed to ensure inbox indexes', error, {
        database: db.databaseName,
      }),
  });

/**
 * A {@link TransactionInbox} over one database, for one consumer.
 *
 * `consumer` is the subscription's durable work-queue name
 * (`<slice>.<pattern>`) — deterministic, and stable across restarts, which an
 * anonymous broadcast queue's server-generated name is not. That is also why
 * `dedupe: 'inbox'` is only legal on a `work` subscription.
 */
export const makeMongoInbox = (db: Db, consumer: string): TransactionInbox => {
  const collection = db.collection<InboxClaim>(INBOX_COLLECTION);

  return {
    claim: eventId =>
      Effect.tryPromise({
        try: async () => {
          try {
            await collection.insertOne(inboxDocument(consumer, eventId));
            return 'claimed' as const;
          } catch (error) {
            // Not a failure: the unique index rejected a second claim for this
            // consumer and message, which is precisely how a redelivery is
            // identified.
            if (isDuplicateKey(error)) {
              return 'duplicate' as const;
            }
            throw error;
          }
        },
        catch: error =>
          new EntifixConnError('Failed to claim inbox entry', error, {
            consumer,
            eventId,
          }),
      }),
  };
};
