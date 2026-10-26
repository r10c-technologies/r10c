import { RedisTag } from '@entifix/redis';
import {
  type IdTokenStore,
  IdTokenStoreTag,
  SESSION_ABSOLUTE_TTL_SECONDS,
} from '@r10c/business-ts-authn';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

const key = (sessionId: string) => `oidc:id-token:${sessionId}`;

/**
 * Redis-backed, expiring with the session's absolute ceiling so a token can
 * never outlive the session it belongs to. Every operation swallows its own
 * failure: a logout that cannot read the hint still revokes the session, which
 * is the part that actually matters.
 */
export const makeRedisIdTokenStore = (redis: Redis): IdTokenStore => ({
  remember: (sessionId, idToken) =>
    Effect.tryPromise(() =>
      redis.set(key(sessionId), idToken, 'EX', SESSION_ABSOLUTE_TTL_SECONDS),
    ).pipe(
      Effect.asVoid,
      Effect.catch(() => Effect.void),
    ),
  take: sessionId =>
    Effect.tryPromise(() => redis.getdel(key(sessionId))).pipe(
      Effect.map(value => value ?? undefined),
      Effect.catch(() => Effect.succeed(undefined)),
    ),
});

/** Provides {@link IdTokenStoreTag} from the same Redis the sessions use. */
export const IdTokenStoreLayer = Layer.effect(
  IdTokenStoreTag,
  Effect.map(RedisTag, makeRedisIdTokenStore),
);
