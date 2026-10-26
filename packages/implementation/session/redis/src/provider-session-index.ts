import { RedisTag } from '@entifix/redis';
import {
  type ProviderSessionIndex,
  ProviderSessionIndexTag,
  SESSION_ABSOLUTE_TTL_SECONDS,
} from '@r10c/business-ts-authn';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

const key = (providerSessionId: string) => `oidc:sid:${providerSessionId}`;

/**
 * Redis-backed, expiring with the session's absolute ceiling so an entry can
 * never outlive the sessions it names.
 *
 * Failures are swallowed, as they are for the id_token: a sign-in must not fail
 * because an index write did. A lost `link` costs precision, not correctness —
 * the route falls back to revoking by `sub` when a `sid` resolves to nothing,
 * which is exactly what a lost write looks like from there.
 *
 * **The set is append-only until `take`, deliberately.** Ids of sessions r10c
 * revoked itself (`logout`, revoke-others, the admin path, `provider-events`,
 * a role change) are left behind. Revoking an already-revoked session is a
 * no-op, and the key expires at the session absolute ceiling, so a set cannot
 * grow without bound.
 *
 * It is also the only thing available: there is no `sessionId -> sid` mapping
 * anywhere in the system, and `SREM` needs the key. Four of the six revocation
 * sites never even learn the ids they killed — `revokeAllForUser`,
 * `revokeAllForUserExcept` and the `sub` fallback all return `void`. Unlinking
 * would mean a second Redis namespace written at the callback, not a call.
 *
 * The invariant that keeps the argument true: **anything added to the
 * back-channel route must stay idempotent.** A stale id is harmless only while
 * the route does nothing with it but revoke. That is the same footing as the
 * deliberately absent `jti` replay store; the two stand or fall together.
 */
export const makeRedisProviderSessionIndex = (
  redis: Redis,
): ProviderSessionIndex => ({
  link: (providerSessionId, sessionId) =>
    Effect.tryPromise(async () => {
      await redis.sadd(key(providerSessionId), sessionId);
      await redis.expire(key(providerSessionId), SESSION_ABSOLUTE_TTL_SECONDS);
    }).pipe(
      Effect.asVoid,
      Effect.catch(() => Effect.void),
    ),
  take: providerSessionId =>
    Effect.tryPromise(async () => {
      const members = await redis.smembers(key(providerSessionId));
      await redis.del(key(providerSessionId));
      return members;
    }).pipe(Effect.catch(() => Effect.succeed([] as readonly string[]))),
});

/** Provides {@link ProviderSessionIndexTag} from the same Redis the sessions use. */
export const ProviderSessionIndexLayer = Layer.effect(
  ProviderSessionIndexTag,
  Effect.map(RedisTag, makeRedisProviderSessionIndex),
);
