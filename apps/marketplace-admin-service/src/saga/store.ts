import {
  type TransactionRecord,
  type TransactionState,
  type TransactionStore,
  TransactionStoreTag,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Context, Effect, Layer } from 'effect';
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
 * This is the `transaction` slice's code, co-deployed into
 * marketplace-admin-service rather than merged with it: it writes the `saga`
 * store and nothing else, and the catalog writes the `catalog` store and nothing
 * else. One process, two owners — which is what makes splitting it back out a
 * matter of moving this directory rather than untangling a database.
 *
 * Events for one transaction arrive in publish order (RabbitMQ per-queue FIFO),
 * so folding is last-write-wins: `accepted` (PENDING) always precedes the
 * terminal `completed`/`failed`.
 */
export const makeMongoTransactionStore = (db: Db): TransactionStore => {
  const collection = db.collection<TransactionRecord>(COLLECTION);

  const fail = (
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => new EntifixConnError(message, error, details);

  return {
    upsertFromEvent: event =>
      Effect.gen(function* () {
        const set: Record<string, unknown> = {
          entity: event.entity,
          state: event.state,
          updatedAt: event.at,
        };
        if (event.organizationId !== undefined) {
          set.organizationId = event.organizationId;
        }
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
          catch: error =>
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
          catch: error =>
            fail('Failed to read back transaction record', error, {
              transactionId: event.transactionId,
            }),
        });
        return record as TransactionRecord;
      }),

    get: transactionId =>
      Effect.tryPromise({
        try: () => collection.findOne({ transactionId }, WITHOUT_MONGO_ID),
        catch: error =>
          fail('Failed to read transaction record', error, { transactionId }),
      }).pipe(Effect.map(doc => doc ?? undefined)),

    list: () =>
      Effect.tryPromise({
        try: () => collection.find({}, WITHOUT_MONGO_ID).toArray(),
        catch: error => fail('Failed to list transaction records', error),
      }),

    findStale: olderThanMs =>
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
        catch: error => fail('Failed to query stale transactions', error),
      }),

    markStale: transactionId =>
      Effect.tryPromise({
        // Guard on state so a race with a terminal event can never downgrade a
        // COMPLETED/FAILED record back to STALE — only a still-PENDING one.
        try: () =>
          collection.updateOne(
            { transactionId, state: { $in: NON_TERMINAL } },
            { $set: { state: 'STALE', updatedAt: new Date().toISOString() } },
          ),
        catch: error =>
          fail('Failed to mark transaction stale', error, { transactionId }),
      }).pipe(Effect.asVoid),
  };
};

/**
 * The database name backing the `saga` store, resolved from config-service.
 *
 * It is a tag rather than a `MongoDatabaseTag` because this process holds more
 * than one Mongo store: the catalog resolves a `tenant_<organizationId>` handle
 * per request, and the saga wants its own single named one. `MongoDatabaseTag`
 * is a single Tag, so both stores reaching for it would mean whichever layer
 * won the merge silently decided where the other one wrote.
 *
 * Naming the handle here is also what keeps the co-deployment reversible: the
 * saga store stops being "whatever the ambient database tag holds" and becomes
 * an explicit `client.db(name)` that moves to another process unchanged.
 */
export class SagaDatabaseName extends Context.Tag('SagaDatabaseName')<
  SagaDatabaseName,
  string
>() {}

/**
 * Provides {@link TransactionStoreTag} from the connection pool
 * ({@link MongoClientTag}) plus an explicit database name, ensuring a unique
 * index on `transactionId` first so concurrent upserts can never create
 * duplicate records for one transaction.
 */
export const MongoTransactionStoreLayer = Layer.effect(
  TransactionStoreTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(yield* SagaDatabaseName);
    yield* Effect.tryPromise({
      try: () =>
        db
          .collection(COLLECTION)
          .createIndex({ transactionId: 1 }, { unique: true }),
      catch: error =>
        new EntifixConnError('Failed to create transactions index', error),
    });
    return makeMongoTransactionStore(db);
  }),
);
