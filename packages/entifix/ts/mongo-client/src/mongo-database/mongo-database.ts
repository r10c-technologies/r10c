import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer, Schedule } from 'effect';
import { Db, MongoClient } from 'mongodb';

/** DI tag carrying a connected mongodb {@link Db} handle. */
export class MongoDatabaseTag extends Context.Tag('MongoDatabaseTag')<
  MongoDatabaseTag,
  Db
>() {}

/**
 * DI tag carrying the connected {@link MongoClient} itself — the **pool**.
 *
 * Exposed alongside {@link MongoDatabaseTag} so a per-organization handle can be
 * resolved with `client.db(name)` inside a request without opening a second
 * connection. Both tags come from one acquire for exactly that reason: two
 * layers over the same URI would mean two pools.
 *
 * Reach for {@link MongoDatabaseTag} unless you are resolving tenant storage.
 */
export class MongoClientTag extends Context.Tag('MongoClientTag')<
  MongoClientTag,
  MongoClient
>() {}

export interface MongoDatabaseSettings {
  readonly uri: string;
  readonly dbName: string;
}

/**
 * A scoped {@link Layer} that opens a {@link MongoClient} on acquire and closes
 * it on release, exposing the client under {@link MongoClientTag} and the
 * resolved {@link Db} under {@link MongoDatabaseTag}. Because it is scoped, the
 * connection is torn down deterministically when the service's root layer is
 * interrupted (the `makeService` graceful-shutdown path).
 */
export const MongoDatabaseLayer = (
  settings: MongoDatabaseSettings,
): Layer.Layer<MongoDatabaseTag | MongoClientTag, EntifixConnError> =>
  Layer.scopedContext(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const client = await MongoClient.connect(settings.uri, {
            // The 30s default means a readiness probe against a missing
            // primary sits for 30s; the registry would time it out first and
            // report a truthful `false`, but the driver would keep the fiber
            // alive behind it. Fail fast instead.
            serverSelectionTimeoutMS: 5_000,
          });
          return { client, db: client.db(settings.dbName) };
        },
        catch: error =>
          new EntifixConnError('Failed to connect to MongoDB', error, {
            dbName: settings.dbName,
          }),
      }).pipe(
        // Boot order is not guaranteed — a service may start while Mongo is
        // still rolling out. Keep trying for a window instead of dying on the
        // first refusal, which leaves a dead process nothing will restart.
        Effect.retry(
          Schedule.exponential('250 millis').pipe(Schedule.upTo('30 seconds')),
        ),
      ),
      ({ client }) => Effect.promise(() => client.close()),
    ).pipe(
      Effect.map(({ client, db }) =>
        Context.make(MongoDatabaseTag, db).pipe(
          Context.add(MongoClientTag, client),
        ),
      ),
    ),
  );
