import type {
  OutboxEntry,
  TransactionOutbox,
} from '@r10c/entifix-transactions';
import { type DomainEvent, EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

/**
 * The outbox collection, and it lives in the **tenant** database beside the
 * entity it describes — not in a shared control-plane store.
 *
 * Two reasons, and the second only shows up later. Same database means the
 * entity write and its event are one single-database transaction, which stays a
 * single-*shard* transaction if this ever shards; a control-plane outbox would
 * be cross-database from the first commit. And an outbox holds event payloads:
 * a `TransactionEvent` carries no tenant data today, but `catalog.published`
 * will carry a whole offering, and that must not land in the control plane on
 * its way to the bus.
 */
export const OUTBOX_COLLECTION = 'transaction_outbox';

/** Drop Mongo's internal `_id` from every read. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;

/** Mongo's duplicate-key error, which is how a replayed command is recognised. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/**
 * The stored shape of an outbox entry.
 *
 * Exported because the `completed` entry is **not** written through the port:
 * it has to join the entity write's session to be atomic with it, and a session
 * cannot live in a framework-free contract. The handler inserts this document
 * itself; everything else goes through {@link makeMongoOutbox}.
 */
export const outboxDocument = (event: DomainEvent): OutboxEntry => ({
  eventId: event.id,
  event,
  sent: false,
  // Defaulted here rather than at each write site because there are two of
  // them: the relay's `enqueue`, and the transaction handler's own insert
  // inside the entity's Mongo session. An entry missing `attempts` would sort
  // into `pending` and then fail `attempts + 1` arithmetic on a `undefined`.
  attempts: 0,
  quarantined: false,
  createdAt: event.at,
});

/**
 * Ensures the two indexes the outbox depends on.
 *
 * The unique one is load-bearing rather than defensive: it *is* the idempotency
 * check behind the client-generated transaction id, so a replayed command is
 * rejected by the storage engine rather than by a read-then-write race. It is on
 * `eventId` — `<transactionId>:<step>` for a transaction — so the claim and the
 * bus's deduplication key are one value rather than two that can drift. The
 * partial one keeps the relay's `pending` query cheap once the collection fills
 * with sent entries; it filters on `quarantined` too, so an entry past its
 * ceiling leaves the index rather than being read and skipped forever.
 *
 * Mongo rejects a `createIndex` that reuses a key pattern with a different
 * `partialFilterExpression` (`IndexOptionsConflict`), and this runs on every
 * sweep and every create. A database that predates the `quarantined` filter
 * therefore fails here on every pass — which is loud only because the sweep now
 * logs what it catches. The fix is `pnpm run <app>:dev:reset`; nothing runs in
 * production, so there is no migration to write.
 */
export const ensureOutboxIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      const collection = db.collection(OUTBOX_COLLECTION);
      await collection.createIndex({ eventId: 1 }, { unique: true });
      await collection.createIndex(
        { createdAt: 1 },
        { partialFilterExpression: { sent: false, quarantined: false } },
      );
    },
    catch: error =>
      new EntifixConnError('Failed to create outbox indexes', error, {
        db: db.databaseName,
      }),
  });

/**
 * Mongo-backed {@link TransactionOutbox} over one tenant database.
 *
 * `db` is closed over, so every method's Effect has `R = never` — the same
 * technique `makeMongoRepository` uses. There is no publishing here: the relay
 * composes these methods with the event bus, which is what lets the relay be
 * tested without a broker.
 */
export const makeMongoOutbox = (db: Db): TransactionOutbox => {
  const collection = db.collection<OutboxEntry>(OUTBOX_COLLECTION);

  const fail = (
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => new EntifixConnError(message, error, details);

  return {
    enqueue: event =>
      Effect.tryPromise({
        try: async () => {
          try {
            await collection.insertOne(outboxDocument(event));
            return 'enqueued' as const;
          } catch (error) {
            // Not a failure: the unique index rejected a second claim for this
            // message id, which is precisely how a retry is identified.
            if (isDuplicateKey(error)) {
              return 'duplicate' as const;
            }
            throw error;
          }
        },
        catch: error =>
          fail('Failed to enqueue outbox entry', error, { eventId: event.id }),
      }),

    pending: limit =>
      Effect.tryPromise({
        // Oldest first, so `accepted` reaches the bus before the terminal event
        // for the same transaction and the tracker folds them in order.
        try: () =>
          collection
            .find({ sent: false, quarantined: false }, WITHOUT_MONGO_ID)
            .sort({ createdAt: 1 })
            .limit(limit)
            .toArray(),
        catch: error =>
          fail('Failed to read pending outbox entries', error, {
            db: db.databaseName,
          }),
      }),

    markSent: entry =>
      Effect.tryPromise({
        try: () =>
          collection.updateOne(
            { eventId: entry.eventId },
            { $set: { sent: true } },
          ),
        catch: error =>
          fail('Failed to mark outbox entry sent', error, {
            eventId: entry.eventId,
          }),
      }).pipe(Effect.asVoid),

    recordFailure: (entry, error, quarantine) =>
      Effect.tryPromise({
        // `$inc` rather than a read-modify-write: two relays can be draining the
        // same tenant (the request's inline drain and the daemon sweep), and an
        // absolute write would let one of them lose the other's attempt and
        // stretch the ceiling indefinitely.
        try: () =>
          collection.updateOne(
            { eventId: entry.eventId },
            {
              $inc: { attempts: 1 },
              $set: { lastError: error, quarantined: quarantine },
            },
          ),
        catch: cause =>
          fail('Failed to record an outbox publish failure', cause, {
            eventId: entry.eventId,
          }),
      }).pipe(Effect.asVoid),
  };
};
