import { createHash, randomBytes } from 'node:crypto';

import {
  type OneTimeTokenStore,
  OneTimeTokenStoreTag,
  type TokenPurpose,
} from '@r10c/entifix-ts-business';
import { EntifixConnError, EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

import { RedisTag } from '../redis-connection/redis-connection';

/** Default key prefix; every key this adapter writes lives under it. */
export const DEFAULT_TOKEN_NAMESPACE = 'ott';

export interface RedisOneTimeTokenStoreOptions {
  readonly namespace?: string;
}

/** 256 bits of randomness — not guessable inside any realistic TTL. */
const mintToken = (): string => randomBytes(32).toString('base64url');

/**
 * SHA-256 of the token.
 *
 * Fast hashing is right here and wrong for passwords: the input already has 256
 * bits of entropy, so there is nothing to brute-force and no salt to add. What
 * this buys is that a dump of Redis contains no redeemable token.
 */
const digest = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Redis-backed {@link OneTimeTokenStore}. The subject is stored under
 * `{ns}:{purpose}:{hash}` with the TTL enforced by Redis, and `consume` uses
 * `GETDEL` so redemption is atomic — two requests racing the same link cannot
 * both succeed.
 */
export const makeRedisOneTimeTokenStore = (
  redis: Redis,
  options: RedisOneTimeTokenStoreOptions = {},
): OneTimeTokenStore => {
  const namespace = options.namespace ?? DEFAULT_TOKEN_NAMESPACE;
  const key = (purpose: TokenPurpose, token: string): string =>
    `${namespace}:${purpose}:${digest(token)}`;

  const attempt = <T>(what: string, run: () => Promise<T>) =>
    Effect.tryPromise({
      try: run,
      catch: error => new EntifixConnError(what, error),
    });

  return {
    issue: (purpose: TokenPurpose, subject: string, ttlSeconds: number) =>
      Effect.gen(function* () {
        const token = mintToken();
        yield* attempt('Redis token issue failed', () =>
          redis.set(key(purpose, token), subject, 'EX', ttlSeconds),
        );
        return token;
      }),

    consume: (purpose: TokenPurpose, token: string) =>
      Effect.gen(function* () {
        // Atomic read-and-delete: without it, two clicks on the same emailed
        // link could each read the subject before either deleted it, and a
        // single-use token would quietly be reusable.
        const subject = yield* attempt('Redis token consume failed', () =>
          redis.getdel(key(purpose, token)),
        );
        if (subject === null) {
          return yield* Effect.fail(
            new EntifixLogicError('Token is unknown, expired or already used'),
          );
        }
        return subject;
      }),
  };
};

/** Provides {@link OneTimeTokenStoreTag} from a {@link RedisTag} connection. */
export const RedisOneTimeTokenStoreLayer = (
  options: RedisOneTimeTokenStoreOptions = {},
) =>
  Layer.effect(
    OneTimeTokenStoreTag,
    Effect.map(RedisTag, redis => makeRedisOneTimeTokenStore(redis, options)),
  );
