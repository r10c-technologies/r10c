import { randomBytes } from 'node:crypto';

import {
  type SessionData,
  type SessionRecord,
  type SessionStore,
  SessionStoreTag,
} from '@r10c/entifix-ts-business';
import {
  EntifixConnError,
  EntifixLogicError,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

import { RedisTag } from '../redis-connection/redis-connection';

/** Default key prefix; every key this adapter writes lives under it. */
export const DEFAULT_SESSION_NAMESPACE = 'session';

export interface RedisSessionStoreOptions {
  /** Key prefix, so several stores can share one Redis without colliding. */
  readonly namespace?: string;
}

/** Mint an unguessable opaque session id (256 bits, url-safe). */
const mintSessionId = (): string => randomBytes(32).toString('base64url');

/**
 * Redis-backed {@link SessionStore}. The session record is a JSON string under
 * `{ns}:{sid}` with the TTL enforced by Redis (`EX`), so an abandoned session
 * expires on its own; `touch` re-`EXPIRE`s it for a sliding window. A parallel
 * `{ns}:user:{userId}` SET indexes a user's live session ids so every one can
 * be revoked at once (password change, admin kick).
 *
 * Closures over the `redis` client give each method `R = never`, so the result
 * is assignable to {@link SessionStoreTag} without leaking a dependency.
 */
export const makeRedisSessionStore = (
  redis: Redis,
  options: RedisSessionStoreOptions = {},
): SessionStore => {
  const namespace = options.namespace ?? DEFAULT_SESSION_NAMESPACE;
  const sessionKey = (sessionId: string): string => `${namespace}:${sessionId}`;
  const userKey = (userId: EntityId): string =>
    `${namespace}:user:${String(userId)}`;

  const attempt = <T>(what: string, run: () => Promise<T>) =>
    Effect.tryPromise({
      try: run,
      catch: (error) => new EntifixConnError(what, error),
    });

  return {
    create: (data: SessionData, ttlSeconds: number) =>
      Effect.gen(function* () {
        const sessionId = mintSessionId();
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
        const record: SessionRecord = {
          ...data,
          sessionId,
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        };
        yield* attempt('Redis session create failed', () =>
          redis.set(sessionKey(sessionId), JSON.stringify(record), 'EX', ttlSeconds),
        );
        yield* attempt('Redis session index failed', () =>
          redis.sadd(userKey(data.userId), sessionId),
        );
        yield* attempt('Redis session index ttl failed', () =>
          redis.expire(userKey(data.userId), ttlSeconds),
        );
        return sessionId;
      }),

    read: (sessionId: string) =>
      Effect.gen(function* () {
        const raw = yield* attempt('Redis session read failed', () =>
          redis.get(sessionKey(sessionId)),
        );
        if (raw === null) {
          return yield* Effect.fail(
            new EntifixLogicError('Session not found or expired', undefined, {
              sessionId,
            }),
          );
        }
        return JSON.parse(raw) as SessionRecord;
      }),

    touch: (sessionId: string, ttlSeconds: number) =>
      Effect.gen(function* () {
        const renewed = yield* attempt('Redis session touch failed', () =>
          redis.expire(sessionKey(sessionId), ttlSeconds),
        );
        if (renewed === 0) {
          return yield* Effect.fail(
            new EntifixLogicError('Session not found or expired', undefined, {
              sessionId,
            }),
          );
        }
      }),

    revoke: (sessionId: string) =>
      Effect.gen(function* () {
        const raw = yield* attempt('Redis session revoke read failed', () =>
          redis.get(sessionKey(sessionId)),
        );
        yield* attempt('Redis session revoke failed', () =>
          redis.del(sessionKey(sessionId)),
        );
        if (raw !== null) {
          const record = JSON.parse(raw) as SessionRecord;
          yield* attempt('Redis session index cleanup failed', () =>
            redis.srem(userKey(record.userId), sessionId),
          );
        }
      }),

    revokeAllForUser: (userId: EntityId) =>
      Effect.gen(function* () {
        const sessionIds = yield* attempt(
          'Redis session index scan failed',
          () => redis.smembers(userKey(userId)),
        );
        for (const sessionId of sessionIds) {
          yield* attempt('Redis session bulk revoke failed', () =>
            redis.del(sessionKey(sessionId)),
          );
        }
        yield* attempt('Redis session index drop failed', () =>
          redis.del(userKey(userId)),
        );
      }),
  };
};

/** Provides {@link SessionStoreTag} from a {@link RedisTag} connection. */
export const RedisSessionStoreLayer = (options: RedisSessionStoreOptions = {}) =>
  Layer.effect(
    SessionStoreTag,
    Effect.map(RedisTag, (redis) => makeRedisSessionStore(redis, options)),
  );
