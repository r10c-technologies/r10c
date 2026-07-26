import { randomBytes } from 'node:crypto';

import {
  type SessionData,
  type SessionLifetimeSeconds,
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
 * The sliding window is bounded: `create` stamps an `absoluteExpiresAt` that
 * `touch` clamps every renewal to, so the Redis TTL can only ever shrink toward
 * that ceiling. This is what keeps "slides while you use it" from degrading
 * into "never expires".
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

  /**
   * Read a record back, giving one written before `absoluteExpiresAt` existed a
   * ceiling instead of leaving it undefined.
   *
   * Sessions outlive a deploy. Without this, the first `touch` of an existing
   * session parsed `undefined` into `NaN`, sailed past the `<= 0` check, and
   * asked Redis to `EX NaN` — so everyone signed in at deploy time got a `500`
   * on their next refresh.
   *
   * The record's own `expiresAt` is the right fallback: under the previous
   * policy it was stamped at creation and never moved, so it already *is* the
   * bound that session was created with. Rewriting the record on touch means
   * each one self-heals the first time it is renewed.
   */
  const parseRecord = (raw: string): SessionRecord => {
    const record = JSON.parse(raw) as SessionRecord;
    return Number.isNaN(Date.parse(record.absoluteExpiresAt ?? ''))
      ? { ...record, absoluteExpiresAt: record.expiresAt }
      : record;
  };

  return {
    create: (data: SessionData, lifetime: SessionLifetimeSeconds) =>
      Effect.gen(function* () {
        const sessionId = mintSessionId();
        const createdAt = new Date();
        // The first window never exceeds the ceiling either — a lifetime whose
        // idle TTL is the longer of the two would otherwise outlive its own cap.
        const ttlSeconds = Math.min(
          lifetime.idleTtlSeconds,
          lifetime.absoluteTtlSeconds,
        );
        const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
        const absoluteExpiresAt = new Date(
          createdAt.getTime() + lifetime.absoluteTtlSeconds * 1000,
        );
        const record: SessionRecord = {
          ...data,
          sessionId,
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        };
        yield* attempt('Redis session create failed', () =>
          redis.set(sessionKey(sessionId), JSON.stringify(record), 'EX', ttlSeconds),
        );
        yield* attempt('Redis session index failed', () =>
          redis.sadd(userKey(data.userId), sessionId),
        );
        // The index outlives any single session so a later one is still
        // revocable through it.
        yield* attempt('Redis session index ttl failed', () =>
          redis.expire(userKey(data.userId), lifetime.absoluteTtlSeconds),
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
        return parseRecord(raw);
      }),

    touch: (sessionId: string, idleTtlSeconds: number) =>
      Effect.gen(function* () {
        const raw = yield* attempt('Redis session touch read failed', () =>
          redis.get(sessionKey(sessionId)),
        );
        if (raw === null) {
          return yield* Effect.fail(
            new EntifixLogicError('Session not found or expired', undefined, {
              sessionId,
            }),
          );
        }

        const record = parseRecord(raw);
        const now = Date.now();
        const secondsToCeiling = Math.floor(
          (Date.parse(record.absoluteExpiresAt) - now) / 1000,
        );
        // Past the ceiling the session is over regardless of how active it has
        // been. Dropping the key here rather than waiting for Redis keeps the
        // user index from listing a session that can no longer be renewed.
        if (secondsToCeiling <= 0) {
          yield* attempt('Redis session capped delete failed', () =>
            redis.del(sessionKey(sessionId)),
          );
          yield* attempt('Redis session index cleanup failed', () =>
            redis.srem(userKey(record.userId), sessionId),
          );
          return yield* Effect.fail(
            new EntifixLogicError('Session reached its absolute lifetime', undefined, {
              sessionId,
              absoluteExpiresAt: record.absoluteExpiresAt,
            }),
          );
        }

        const ttlSeconds = Math.min(idleTtlSeconds, secondsToCeiling);
        const renewed: SessionRecord = {
          ...record,
          expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
        };
        yield* attempt('Redis session touch failed', () =>
          redis.set(
            sessionKey(sessionId),
            JSON.stringify(renewed),
            'EX',
            ttlSeconds,
          ),
        );
      }),

    listForUser: (userId: EntityId) =>
      Effect.gen(function* () {
        const sessionIds = yield* attempt(
          'Redis session index scan failed',
          () => redis.smembers(userKey(userId)),
        );

        const records: SessionRecord[] = [];
        const stale: string[] = [];
        for (const sessionId of sessionIds) {
          const raw = yield* attempt('Redis session list read failed', () =>
            redis.get(sessionKey(sessionId)),
          );
          // The index has no way to learn that Redis expired a record on its
          // own, so it accumulates ids pointing at nothing. Pruning them here
          // keeps a session list from showing rows that are already gone.
          if (raw === null) stale.push(sessionId);
          else records.push(parseRecord(raw));
        }
        for (const sessionId of stale) {
          yield* attempt('Redis session index prune failed', () =>
            redis.srem(userKey(userId), sessionId),
          );
        }

        return records;
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
          const record = parseRecord(raw);
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

    revokeAllForUserExcept: (userId: EntityId, keepSessionId: string) =>
      Effect.gen(function* () {
        const sessionIds = yield* attempt(
          'Redis session index scan failed',
          () => redis.smembers(userKey(userId)),
        );
        for (const sessionId of sessionIds) {
          if (sessionId === keepSessionId) continue;
          yield* attempt('Redis session bulk revoke failed', () =>
            redis.del(sessionKey(sessionId)),
          );
          yield* attempt('Redis session index cleanup failed', () =>
            redis.srem(userKey(userId), sessionId),
          );
        }
      }),
  };
};

/** Provides {@link SessionStoreTag} from a {@link RedisTag} connection. */
export const RedisSessionStoreLayer = (options: RedisSessionStoreOptions = {}) =>
  Layer.effect(
    SessionStoreTag,
    Effect.map(RedisTag, (redis) => makeRedisSessionStore(redis, options)),
  );
