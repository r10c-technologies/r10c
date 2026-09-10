import {
  type SagaInstance,
  type SagaState,
  type SagaStepOutcome,
  SagaStoreTag,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import { SagaDatabaseName } from './store';

/**
 * Saga instances, beside the transaction records in the same `saga` store.
 *
 * A saga instance *is* a transaction's state with steps in it, so it belongs in
 * the store that already holds transaction state — no new store, and the
 * `transaction` slice keeps `domains: []`, because orchestration is a mechanism
 * rather than a business domain (ADR 0039).
 */
export const SAGA_COLLECTION = 'saga_instances';

const failed = (message: string, sagaId: string) => (error: unknown) =>
  new EntifixConnError(message, error, { sagaId });

export const sagaCollection = (db: Db) =>
  db.collection<SagaInstance>(SAGA_COLLECTION);

export const makeMongoSagaStore = (db: Db) => {
  const collection = sagaCollection(db);
  const stamp = () => new Date().toISOString();

  return {
    start: (instance: Omit<SagaInstance, 'updatedAt'>) =>
      Effect.tryPromise({
        try: async () => {
          // `upsert` rather than `insertOne`: a coordinator restarted mid-flight
          // re-enters here with an id it already wrote, and refusing that would
          // turn a recoverable resume into a hard failure.
          await collection.updateOne(
            { sagaId: instance.sagaId },
            { $setOnInsert: { ...instance, updatedAt: stamp() } },
            { upsert: true },
          );
        },
        catch: failed('Failed to start the saga instance', instance.sagaId),
      }),

    beginStep: (sagaId: string, stepIndex: number) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            { $set: { stepIndex, updatedAt: stamp() } },
          );
        },
        catch: failed('Failed to record the step transition', sagaId),
      }),

    recordOutcome: (sagaId: string, outcome: SagaStepOutcome) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            {
              // `$push`, never a read-modify-write of the array: two steps
              // recorded from one process would otherwise lose one another's
              // outcome, and an outcome that is lost is a compensation that
              // cannot address what it has to undo.
              $push: { outcomes: outcome },
              $set: { updatedAt: stamp() },
            },
          );
        },
        catch: failed('Failed to record the step outcome', sagaId),
      }),

    settle: (sagaId: string, state: SagaState, error?: string) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            { $set: { state, error, updatedAt: stamp() } },
          );
        },
        catch: failed('Failed to settle the saga instance', sagaId),
      }),

    /**
     * Take ownership of a stale instance, or answer `undefined`.
     *
     * ⚠️ **One conditional write, not a read and then a write.** The filter
     * repeats `findStale`'s predicate, so two sweepers racing the same instance
     * produce one winner: the loser's filter no longer matches because the
     * winner re-stamped `updatedAt`. That stamp is also what stops this sweep's
     * *next* tick finding the instance it is still working on.
     */
    claimForResume: (sagaId: string, olderThanMs: number) =>
      Effect.tryPromise({
        try: async () => {
          const claimed = await collection.findOneAndUpdate(
            {
              sagaId,
              state: { $in: ['RUNNING', 'COMPENSATING'] },
              updatedAt: {
                $lt: new Date(Date.now() - olderThanMs).toISOString(),
              },
            },
            { $inc: { resumeAttempts: 1 }, $set: { updatedAt: stamp() } },
            { returnDocument: 'after', projection: { _id: 0 } },
          );
          return (claimed ?? undefined) as SagaInstance | undefined;
        },
        catch: failed('Failed to claim the saga instance', sagaId),
      }),

    /**
     * Flag one step's calls as given back.
     *
     * The positional filter addresses the outcome by its step id rather than by
     * index: outcomes are `$push`ed, so an index is a fact about arrival order
     * and a resumed walk must not depend on one.
     */
    markCompensated: (sagaId: string, stepId: string) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            {
              $set: { 'outcomes.$[entry].compensated': true, updatedAt: stamp() },
            },
            { arrayFilters: [{ 'entry.stepId': stepId }] },
          );
        },
        catch: failed('Failed to mark the step compensated', sagaId),
      }),

    get: (sagaId: string) =>
      Effect.tryPromise({
        try: () =>
          collection.findOne({ sagaId }, { projection: { _id: 0 } }) as Promise<
            SagaInstance | undefined
          >,
        catch: failed('Failed to read the saga instance', sagaId),
      }).pipe(Effect.map(found => found ?? undefined)),

    /**
     * Instances stuck mid-flight past a deadline.
     *
     * ⚠️ `COMPENSATING` counts as stuck, not just `RUNNING`. A coordinator that
     * died while unwinding is the state that leaves holds in place, and it is
     * the one an operator most needs to find.
     */
    findStale: (olderThanMs: number) =>
      Effect.tryPromise({
        try: () =>
          collection
            .find(
              {
                state: { $in: ['RUNNING', 'COMPENSATING'] },
                updatedAt: {
                  $lt: new Date(Date.now() - olderThanMs).toISOString(),
                },
              },
              { projection: { _id: 0 } },
            )
            .toArray() as Promise<SagaInstance[]>,
        catch: failed('Failed to find stale saga instances', ''),
      }),
  };
};

/**
 * Provides {@link SagaStoreTag} from the pool plus the explicit `saga` database
 * name, with a unique index on `sagaId` so a resumed coordinator can never
 * create a second instance for one flow, and a `{ state, updatedAt }` index for
 * the sweep that finds the ones nobody finished.
 */
export const MongoSagaStoreLayer = Layer.effect(
  SagaStoreTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = client.db(yield* SagaDatabaseName);
    yield* Effect.tryPromise({
      try: async () => {
        await sagaCollection(db).createIndex({ sagaId: 1 }, { unique: true });
        // The sweep's predicate. Without it every pass is a collection scan of
        // every saga ever run, on a schedule.
        await sagaCollection(db).createIndex({ state: 1, updatedAt: 1 });
      },
      catch: error =>
        new EntifixConnError('Failed to create the saga instance index', error),
    });
    return makeMongoSagaStore(db);
  }),
);
