import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer } from 'effect';
import { Db, MongoClient } from 'mongodb';

/** DI tag carrying a connected mongodb {@link Db} handle. */
export class MongoDatabaseTag extends Context.Tag('MongoDatabaseTag')<
  MongoDatabaseTag,
  Db
>() {}

export interface MongoDatabaseSettings {
  readonly uri: string;
  readonly dbName: string;
}

/**
 * A scoped {@link Layer} that opens a {@link MongoClient} on acquire and closes
 * it on release, exposing the resolved {@link Db} under {@link MongoDatabaseTag}.
 * Because it is scoped, the connection is torn down deterministically when the
 * service's root layer is interrupted (the `makeService` graceful-shutdown path).
 */
export const MongoDatabaseLayer = (
  settings: MongoDatabaseSettings,
): Layer.Layer<MongoDatabaseTag, EntifixConnError> =>
  Layer.scoped(
    MongoDatabaseTag,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const client = await MongoClient.connect(settings.uri);
          return { client, db: client.db(settings.dbName) };
        },
        catch: error =>
          new EntifixConnError('Failed to connect to MongoDB', error, {
            dbName: settings.dbName,
          }),
      }),
      ({ client }) => Effect.promise(() => client.close()),
    ).pipe(Effect.map(({ db }) => db)),
  );
