import {
  TRANSACTION_STATES,
  type TransactionEvent,
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
 * The fold itself, as a filter and an update — the shape that turns one
 * observed event into the persisted record.
 *
 * Exported for the same reason `outboxDocument` is: the fold that runs in
 * production is **not** written through the port. It has to join the inbox
 * claim's session to be atomic with it, and a session cannot live in a
 * framework-free contract, so the consumer issues this update itself. Keeping
 * the shape here means the two write sites cannot disagree about what a fold
 * is.
 *
 * Last-write-wins on `$set`, `$setOnInsert` for the two members only the first
 * event can know: events for one transaction arrive in publish order (RabbitMQ
 * per-queue FIFO), so `accepted` always precedes the terminal event.
 */
export const transactionFold = (event: TransactionEvent) => {
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

  return {
    filter: { transactionId: event.transactionId },
    update: {
      $set: set,
      $setOnInsert: {
        transactionId: event.transactionId,
        createdAt: event.at,
      },
    },
  } as const;
};

/** The collection the fold writes, so a session-aware caller can reach it. */
export const transactionsCollection = (db: Db) =>
  db.collection<TransactionRecord>(COLLECTION);

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
        const { filter, update } = transactionFold(event);

        yield* Effect.tryPromise({
          try: () => collection.updateOne(filter, update, { upsert: true }),
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

    countByState: () =>
      Effect.tryPromise({
        // An aggregation rather than one `countDocuments` per state, so the
        // number of round trips does not grow with `TransactionState`.
        try: async () => {
          const rows = await collection
            .aggregate<{ _id: TransactionState; count: number }>([
              { $group: { _id: '$state', count: { $sum: 1 } } },
            ])
            .toArray();

          // Every state, always — including the ones at zero. A gauge that
          // simply stops reporting a series is read by most dashboards as "no
          // data" rather than as "none", so `STALE` dropping to zero would look
          // identical to the metric having broken.
          const counts = Object.fromEntries(
            TRANSACTION_STATES.map(state => [state, 0]),
          ) as Record<TransactionState, number>;
          for (const row of rows) {
            if (TRANSACTION_STATES.includes(row._id))
              counts[row._id] = row.count;
          }
          return counts;
        },
        catch: error => fail('Failed to count transactions by state', error),
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
