import { createHash } from 'node:crypto';

import type { AttemptLimiter, LockState } from '@r10c/business-ts-authn';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Redis } from 'ioredis';

/** Failures from ONE source before that source is locked out. */
export const MAX_ATTEMPTS_PER_SOURCE = 5;
/** Distinct sources failing before the identifier is locked everywhere. */
export const MAX_FAILING_SOURCES = 3;
/** How long a lock lasts, and how long counters survive without a failure. */
export const LOCK_TTL_SECONDS = 60 * 15;

const UNLOCKED: LockState = {
  locked: false,
  retryAfterSeconds: 0,
  justLocked: false,
};

/**
 * The identifier is hashed into the key.
 *
 * Redis then holds no list of the email addresses that have been attempted here,
 * which is worth avoiding for a store that is easier to dump than the database.
 */
const tag = (value: string): string =>
  createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 32);

/**
 * Redis-backed {@link AttemptLimiter}.
 *
 * Counting per identifier+source first, and only widening to the identifier once
 * several sources have failed, is what keeps this from being a remote lock-out
 * button: one attacker hammering one address exhausts their own bucket and
 * nobody else's.
 */
export const makeRedisAttemptLimiter = (redis: Redis): AttemptLimiter => {
  const sourceKey = (identifier: string, source: string): string =>
    `lockout:src:${tag(identifier)}:${tag(source)}`;
  const identifierKey = (identifier: string): string =>
    `lockout:id:${tag(identifier)}`;
  const sourcesKey = (identifier: string): string =>
    `lockout:sources:${tag(identifier)}`;

  const attempt = <T>(what: string, run: () => Promise<T>) =>
    Effect.tryPromise({
      try: run,
      catch: error => new EntifixConnError(what, error),
    });

  const stateFor = (identifier: string, source: string) =>
    Effect.gen(function* () {
      const [wide, mine] = yield* attempt('Redis lockout read failed', () =>
        Promise.all([
          redis.ttl(identifierKey(identifier)),
          redis.get(sourceKey(identifier, source)),
        ]),
      );

      if (wide > 0) {
        return { locked: true, retryAfterSeconds: wide, justLocked: false };
      }
      const failures = Number(mine ?? 0);
      if (failures >= MAX_ATTEMPTS_PER_SOURCE) {
        const ttl = yield* attempt('Redis lockout ttl failed', () =>
          redis.ttl(sourceKey(identifier, source)),
        );
        return {
          locked: true,
          retryAfterSeconds: Math.max(ttl, 1),
          justLocked: false,
        };
      }
      return UNLOCKED;
    });

  return {
    check: stateFor,

    fail: (identifier: string, source: string) =>
      Effect.gen(function* () {
        const failures = yield* attempt('Redis lockout increment failed', () =>
          redis.incr(sourceKey(identifier, source)),
        );
        yield* attempt('Redis lockout expire failed', () =>
          redis.expire(sourceKey(identifier, source), LOCK_TTL_SECONDS),
        );

        if (failures < MAX_ATTEMPTS_PER_SOURCE) return UNLOCKED;

        // This source is done. Record it among the sources that have failed for
        // this identifier; enough distinct ones means a real distributed attempt
        // rather than one person mistyping.
        const distinct = yield* attempt('Redis lockout source add failed', () =>
          redis
            .sadd(sourcesKey(identifier), tag(source))
            .then(() => redis.scard(sourcesKey(identifier))),
        );
        yield* attempt('Redis lockout sources expire failed', () =>
          redis.expire(sourcesKey(identifier), LOCK_TTL_SECONDS),
        );

        if (distinct < MAX_FAILING_SOURCES) {
          return {
            locked: true,
            retryAfterSeconds: LOCK_TTL_SECONDS,
            justLocked: failures === MAX_ATTEMPTS_PER_SOURCE,
          };
        }

        const alreadyWide = yield* attempt('Redis lockout ttl failed', () =>
          redis.ttl(identifierKey(identifier)),
        );
        yield* attempt('Redis lockout set failed', () =>
          redis.set(identifierKey(identifier), '1', 'EX', LOCK_TTL_SECONDS),
        );
        return {
          locked: true,
          retryAfterSeconds: LOCK_TTL_SECONDS,
          // Only the transition notifies, so a sustained attack does not mail
          // the owner once per attempt.
          justLocked: alreadyWide <= 0,
        };
      }),

    succeed: (identifier: string, source: string) =>
      attempt('Redis lockout clear failed', () =>
        redis.del(sourceKey(identifier, source)),
      ).pipe(Effect.asVoid),
  };
};
