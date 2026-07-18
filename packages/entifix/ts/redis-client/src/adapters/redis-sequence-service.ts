import { type SequenceService,SequenceServiceTag } from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

import { RedisTag } from '../redis-connection/redis-connection';

/** Namespace so sequence keys never collide with lock keys. */
const SEQ_PREFIX = 'seq:';

/**
 * Redis-backed {@link SequenceService}. `INCR` is atomic, so concurrent
 * commands across every service instance draw strictly distinct values — the
 * uniqueness guarantee behind incremental codes.
 */
export const makeRedisSequenceService = (redis: Redis): SequenceService => ({
  next: (name) =>
    Effect.tryPromise({
      try: () => redis.incr(`${SEQ_PREFIX}${name}`),
      catch: (error) =>
        new EntifixConnError('Redis INCR failed', error, { name }),
    }),
});

/** Provides {@link SequenceServiceTag} from a {@link RedisTag} connection. */
export const RedisSequenceServiceLayer = Layer.effect(
  SequenceServiceTag,
  Effect.map(RedisTag, makeRedisSequenceService),
);
