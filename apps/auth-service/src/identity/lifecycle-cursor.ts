import { RedisTag } from '@r10c/entifix-ts-redis-client';
import { Context, Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

/**
 * How far back a first sweep reaches when no cursor has been stored yet.
 *
 * Deliberately generous and deliberately bounded. A fresh process has no idea
 * what it missed, and the whole reason this exists is that nothing recorded the
 * gap; reaching back a day covers the case this is for — a laptop where
 * auth-service is routinely down while the rest of the fleet is up — without
 * replaying an instance's entire history on every new deployment.
 *
 * Nothing is lost by being wrong here in the long direction: every effect is a
 * revoke, and revoking an already-revoked session is a no-op.
 */
const COLD_START_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * How far before the stored cursor each sweep re-reads.
 *
 * ⚠️ **The overlap is the correctness argument, not a safety margin.** The
 * cursor is a *timestamp*, and a timestamp cannot distinguish "this event is
 * newer than the last one I saw" from "this event was recorded in the same
 * millisecond and I have already handled it". Re-reading a window costs
 * duplicate revokes, which are free, while a cursor that advanced past an event
 * loses it permanently — the exact failure this whole mechanism exists to
 * close.
 *
 * A sequence number would need no overlap, and is the better answer if this ever
 * becomes expensive. It is not, at one sweep every few minutes.
 */
const OVERLAP_MS = 60 * 1000;

/** Where the cursor lives. Redis, beside the sessions the sweep revokes. */
const KEY = 'oidc:lifecycle-cursor';

export interface LifecycleCursor {
  /** The timestamp a sweep should read from, overlap already applied. */
  read: Effect.Effect<string>;
  /** Record how far this sweep got. */
  write(at: string): Effect.Effect<void>;
}

export class LifecycleCursorTag extends Context.Tag('LifecycleCursorTag')<
  LifecycleCursorTag,
  LifecycleCursor
>() {}

/**
 * The reconciler's place in the provider's event stream.
 *
 * Redis rather than Mongo because it is operational state rather than a record:
 * losing it costs one wider sweep, and the cold-start lookback above is exactly
 * what a loss degrades to. It carries no TTL — a cursor that expired would
 * silently reset the reconciler to that lookback, which is the same bug as
 * losing it but harder to notice.
 *
 * Failures are swallowed on **write** and fall back to the lookback on
 * **read**. A sweep that cannot store its cursor must not crash the daemon; the
 * next pass simply re-reads a wider window and revokes the same sessions again,
 * which changes nothing.
 */
export const makeRedisLifecycleCursor = (redis: Redis): LifecycleCursor => ({
  read: Effect.promise(() => redis.get(KEY)).pipe(
    Effect.catchAllDefect(() => Effect.succeed(null)),
    Effect.map(stored =>
      typeof stored === 'string' && stored !== ''
        ? new Date(Date.parse(stored) - OVERLAP_MS).toISOString()
        : new Date(Date.now() - COLD_START_LOOKBACK_MS).toISOString(),
    ),
    Effect.catchAll(() =>
      Effect.succeed(
        new Date(Date.now() - COLD_START_LOOKBACK_MS).toISOString(),
      ),
    ),
  ),
  write: (at: string) =>
    Effect.promise(() => redis.set(KEY, at)).pipe(
      Effect.catchAllDefect(() => Effect.void),
      Effect.asVoid,
    ),
});

/** Binds {@link LifecycleCursorTag} over the service's Redis connection. */
export const LifecycleCursorLayer = Layer.effect(
  LifecycleCursorTag,
  Effect.map(RedisTag, makeRedisLifecycleCursor),
);
