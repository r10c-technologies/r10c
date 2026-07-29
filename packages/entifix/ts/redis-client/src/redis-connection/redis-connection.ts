import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, Effect, Layer, Schedule } from 'effect';
import { Redis } from 'ioredis';

/** DI tag carrying a connected ioredis client. */
export class RedisTag extends Context.Tag('RedisTag')<RedisTag, Redis>() {}

export interface RedisSettings {
  readonly uri: string;
}

/**
 * How long the initial connect keeps trying before the service gives up.
 *
 * Boot order is not guaranteed: a service can start while Redis is still
 * rolling out (`ensure-infra` brought the cluster up moments earlier), and
 * dying on the first refused connection turns a five-second wait into a dead
 * process that nothing restarts.
 */
const CONNECT_RETRY_WINDOW = '30 seconds';

/**
 * A scoped {@link Layer} that opens an ioredis connection on acquire and quits
 * it on release, mirroring `MongoDatabaseLayer`. `lazyConnect` + an explicit
 * `connect()` surfaces a bad URI/credentials at boot instead of on first command.
 *
 * The reconnect policy is spelled out rather than left to defaults, because two
 * defaults are actively wrong for a service with a readiness endpoint:
 *
 * - **`enableOfflineQueue: false`** — the default queues commands while the
 *   connection is down, so a health probe *hangs* instead of failing. Readiness
 *   has to answer fastest exactly when a datastore is gone.
 * - **an explicit `retryStrategy`** — so a connection that drops (Redis
 *   restarted, pod rescheduled) is re-established for the lifetime of the
 *   process. Without it the client can settle into a terminal state and the
 *   service stays degraded until someone restarts it, even after Redis is back.
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
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            retryStrategy: times => Math.min(times * 200, 5_000),
          });
          await redis.connect();
          return redis;
        },
        catch: error =>
          new EntifixConnError('Failed to connect to Redis', error),
      }).pipe(
        Effect.retry(
          Schedule.exponential('250 millis').pipe(
            Schedule.upTo(CONNECT_RETRY_WINDOW),
          ),
        ),
      ),
      redis =>
        Effect.promise(() =>
          redis
            .quit()
            .then(() => undefined)
            .catch(() => undefined),
        ),
    ),
  );
