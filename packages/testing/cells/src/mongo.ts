import { MongoDatabaseTag } from '@entifix/mongo';
import {
  makeMongoUnitOfWork,
  MongoUnitOfWorkTag,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

type Fake = ReturnType<typeof makeFakeMongoDb>;

/**
 * A persistence cell over the driver fake, with what a fixed-database store
 * needs around it: the database, a unit of work over the same fake, a bus
 * that records what it was handed, and the outbox's attempt limit.
 *
 * `run` provides the cell's layer to an effect and runs it, so a spec reads
 * `world.run(Effect.flatMap(StoreTag, store => …))`.
 */
export const mongoCellWorld = <A, E>(
  layer: Layer.Layer<A, E, MongoDatabaseTag | MongoUnitOfWorkTag | EventBusTag | OutboxMaxAttempts | EventSourceTag>,
  options: {
    readonly source: string;
    readonly seed?: Record<string, Record<string, unknown>[]>;
  },
) => {
  const fake = makeFakeMongoDb(options.seed ?? {});
  const bus = makeRecordingEventBus();
  const db = fake.db as Db;
  const provided = layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MongoDatabaseTag, db),
        Layer.succeed(
          MongoUnitOfWorkTag,
          makeMongoUnitOfWork({ client: fake as never, db }),
        ),
        Layer.succeed(EventBusTag, bus),
        Layer.succeed(OutboxMaxAttempts, 3),
        Layer.succeed(EventSourceTag, options.source),
      ),
    ),
  );
  const run = <B, F>(effect: Effect.Effect<B, F, A>) =>
    Effect.runPromise(effect.pipe(Effect.provide(provided)));
  return { fake, bus, db, run };
};

/**
 * Fails only the `nth` call (1-based) of one operation on one collection of
 * `fake`, leaving every other call alone — the way a write that succeeds and a
 * read that then fails reaches a distinct error branch. A store captures its
 * collections when it is built, so call this before building it.
 */
export const failNth = (
  fake: Fake,
  collection: string,
  op: string,
  nth: number,
) => {
  const db = fake.db as unknown as { collection: (name: string) => object };
  const real = db.collection.bind(db);
  let calls = 0;
  db.collection = (name: string) => {
    const handle = real(name) as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    if (name !== collection) return handle;
    return new Proxy(handle, {
      get: (target, key) =>
        key !== op
          ? target[key as string]
          : (...args: unknown[]) => {
              calls += 1;
              if (calls !== nth) {
                return (target[op] as (...a: unknown[]) => unknown)(...args);
              }
              const failure = () =>
                Promise.reject(new Error(`${op} #${nth} failed`));
              // `find` answers a cursor; it is the cursor's read that fails.
              return op === 'find' ? { toArray: failure } : failure();
            },
    });
  };
};
