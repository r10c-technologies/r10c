import {
  type TransactionRecord,
  type TransactionState,
  type TransactionStore,
  TransactionStoreTag,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { MongoDatabaseTag } from '@r10c/entifix-ts-mongo-client';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

/** The single collection the manager folds transaction events into. */
const COLLECTION = 'transactions';
/** Drop Mongo's internal `_id` from every read. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;
/** Non-terminal states a recovery sweep may flag as stale. */
const NON_TERMINAL: readonly TransactionState[] = ['PENDING'];

/**
 * Mongo-backed {@link TransactionStore}. Lives in the service (not
 * `entifix-ts-mongo-client`) so the adapter package stays free of a transactions
 * dependency. `db` is closed over, so every method's Effect has `R = never`.
 *
 * Events for one transaction arrive in publish order (RabbitMQ per-queue FIFO),
 * so folding is last-write-wins: `accepted` (PENDING) always precedes the
 * terminal `completed`/`failed`.
 */
export const makeMongoTransactionStore = (db: Db): TransactionStore => {
  const collection = db.collection<TransactionRecord>(COLLECTION);

  const fail = (message: string, error: unknown, details?: Record<string, unknown>) =>
    new EntifixConnError(message, error, details);

  return {
    upsertFromEvent: (event) =>
      Effect.gen(function* () {
        const set: Record<string, unknown> = {
          entity: event.entity,
          state: event.state,
          updatedAt: event.at,
        };
        if (event.code !== undefined) set.code = event.code;
        if (event.entityId !== undefined) set.entityId = event.entityId;
        if (event.error !== undefined) set.error = event.error;

        yield* Effect.tryPromise({
          try: () =>
            collection.updateOne(
              { transactionId: event.transactionId },
              {
                $set: set,
                $setOnInsert: {
                  transactionId: event.transactionId,
                  createdAt: event.at,
                },
              },
              { upsert: true },
            ),
          catch: (error) =>
            fail('Failed to upsert transaction record', error, {
              transactionId: event.transactionId,
            }),
        });

        const record = yield* Effect.tryPromise({
          try: () =>
            collection.findOne(
              { transactionId: event.transactionId },
              WITHOUT_MONGO_ID,
            ),
          catch: (error) =>
            fail('Failed to read back transaction record', error, {
              transactionId: event.transactionId,
            }),
        });
        return record as TransactionRecord;
      }),

    get: (transactionId) =>
      Effect.tryPromise({
        try: () => collection.findOne({ transactionId }, WITHOUT_MONGO_ID),
        catch: (error) =>
          fail('Failed to read transaction record', error, { transactionId }),
      }).pipe(Effect.map((doc) => doc ?? undefined)),

    list: () =>
      Effect.tryPromise({
        try: () => collection.find({}, WITHOUT_MONGO_ID).toArray(),
        catch: (error) => fail('Failed to list transaction records', error),
      }),

    findStale: (olderThanMs) =>
      Effect.tryPromise({
        try: () => {
          const cutoff = new Date(Date.now() - olderThanMs).toISOString();
          return collection
            .find(
              { state: { $in: NON_TERMINAL }, updatedAt: { $lt: cutoff } },
              WITHOUT_MONGO_ID,
            )
            .toArray();
        },
        catch: (error) => fail('Failed to query stale transactions', error),
      }),

    markStale: (transactionId) =>
      Effect.tryPromise({
        // Guard on state so a race with a terminal event can never downgrade a
        // COMPLETED/FAILED record back to STALE — only a still-PENDING one.
        try: () =>
          collection.updateOne(
            { transactionId, state: { $in: NON_TERMINAL } },
            { $set: { state: 'STALE', updatedAt: new Date().toISOString() } },
          ),
        catch: (error) =>
          fail('Failed to mark transaction stale', error, { transactionId }),
      }).pipe(Effect.asVoid),
  };
};

/**
 * Provides {@link TransactionStoreTag} from a {@link MongoDatabaseTag}, ensuring
 * a unique index on `transactionId` first so concurrent upserts can never create
 * duplicate records for one transaction.
 */
export const MongoTransactionStoreLayer = Layer.effect(
  TransactionStoreTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    yield* Effect.tryPromise({
      try: () =>
        db
          .collection(COLLECTION)
          .createIndex({ transactionId: 1 }, { unique: true }),
      catch: (error) =>
        new EntifixConnError('Failed to create transactions index', error),
    });
    return makeMongoTransactionStore(db);
  }),
);
