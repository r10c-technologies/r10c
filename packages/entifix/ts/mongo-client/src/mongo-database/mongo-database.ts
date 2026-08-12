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

export interface MongoClientSettings {
  readonly uri: string;
}

export interface MongoDatabaseSettings extends MongoClientSettings {
  readonly dbName: string;
}

/**
 * A scoped {@link Layer} that opens a {@link MongoClient} on acquire and closes
 * it on release, exposing it under {@link MongoClientTag}. Because it is scoped,
 * the connection is torn down deterministically when the service's root layer is
 * interrupted (the `makeService` graceful-shutdown path).
 *
 * This is the layer to reach for when a service names **no** database at boot —
 * one that resolves every handle per request (tenant storage) or holds several
 * named stores in one process. Naming a database it never writes would put a
 * phantom store in the register, which is the thing ADR 0020 forbids.
 *
 * {@link MongoDatabaseLayer} builds on this rather than connecting again: two
 * layers over the same URI would mean two pools.
 */
export const MongoClientLayer = (
  settings: MongoClientSettings,
): Layer.Layer<MongoClientTag, EntifixConnError> =>
  Layer.scoped(
    MongoClientTag,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          MongoClient.connect(settings.uri, {
            // The 30s default means a readiness probe against a missing
            // primary sits for 30s; the registry would time it out first and
            // report a truthful `false`, but the driver would keep the fiber
            // alive behind it. Fail fast instead.
            serverSelectionTimeoutMS: 5_000,
          }),
        catch: error =>
          new EntifixConnError('Failed to connect to MongoDB', error),
      }).pipe(
        // Boot order is not guaranteed — a service may start while Mongo is
        // still rolling out. Keep trying for a window instead of dying on the
        // first refusal, which leaves a dead process nothing will restart.
        Effect.retry(
          Schedule.exponential('250 millis').pipe(Schedule.upTo('30 seconds')),
        ),
      ),
      client => Effect.promise(() => client.close()),
    ),
  );

/**
 * {@link MongoClientLayer} plus the named {@link Db} resolved from it, exposed
 * under {@link MongoDatabaseTag}. One acquire, one pool, both tags — which is
 * why a service that wants both must not merge the two layers.
 *
 * Use it when the service owns exactly one named store (`auth-service`). A
 * service whose handles are all per-request wants {@link MongoClientLayer}.
 */
export const MongoDatabaseLayer = (
  settings: MongoDatabaseSettings,
): Layer.Layer<MongoDatabaseTag | MongoClientTag, EntifixConnError> =>
  Layer.provideMerge(
    Layer.effect(
      MongoDatabaseTag,
      Effect.map(MongoClientTag, client => client.db(settings.dbName)),
    ),
    MongoClientLayer(settings),
  );
