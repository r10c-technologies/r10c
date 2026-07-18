import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer } from 'effect';
import { Redis } from 'ioredis';

/** DI tag carrying a connected ioredis client. */
export class RedisTag extends Context.Tag('RedisTag')<RedisTag, Redis>() {}

export interface RedisSettings {
  readonly uri: string;
}

/**
 * A scoped {@link Layer} that opens an ioredis connection on acquire and quits
 * it on release, mirroring `MongoDatabaseLayer`. `lazyConnect` + an explicit
 * `connect()` surfaces a bad URI/credentials at boot instead of on first command.
 */
export const RedisLayer = (
  settings: RedisSettings,
): Layer.Layer<RedisTag, EntifixConnError> =>
  Layer.scoped(
    RedisTag,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const redis = new Redis(settings.uri, {
            lazyConnect: true,
            maxRetriesPerRequest: 3,
          });
          await redis.connect();
          return redis;
        },
        catch: (error) =>
          new EntifixConnError('Failed to connect to Redis', error),
      }),
      (redis) =>
        Effect.promise(() =>
          redis
            .quit()
            .then(() => undefined)
            .catch(() => undefined),
        ),
    ),
  );
