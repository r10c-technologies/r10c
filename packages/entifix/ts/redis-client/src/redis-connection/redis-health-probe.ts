import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { RedisTag } from './redis-connection';

/** Probe name reported by `/api/health/ready` when Redis is unreachable. */
export const REDIS_PROBE_NAME = 'redis';

/**
 * Registers a readiness probe for the Redis connection: `PING`.
 *
 * Sessions live here, so a service that cannot reach Redis can still answer
 * liveness (its process is fine) while readiness reports the truth — which is
 * exactly the split Kubernetes acts on: drain traffic, do not restart.
 */
export const RedisHealthProbeLayer: Layer.Layer<
  never,
  never,
  RedisTag | HealthRegistryTag
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const redis = yield* RedisTag;
    const registry = yield* HealthRegistryTag;

    yield* registry.register({
      name: REDIS_PROBE_NAME,
      check: Effect.tryPromise(() => redis.ping()).pipe(
        Effect.map(reply => reply === 'PONG'),
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    });
  }),
);
