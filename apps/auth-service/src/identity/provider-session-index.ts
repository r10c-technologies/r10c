import { RedisTag } from '@r10c/entifix-ts-redis-client';
import { Context, Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

import { SESSION_ABSOLUTE_TTL_SECONDS } from './session-policy';

/**
 * Maps the provider's session id (`sid`) back to the r10c sessions it opened.
 *
 * Sign-out already propagates r10c → Zitadel. This is what makes the reverse
 * possible: a back-channel logout token names a session at the *provider*, and
 * our session id is our own, so without this index there is nothing for that
 * token to point at and the session survives to its 7-day ceiling.
 *
 * A **set**, not a single id, because one Zitadel session can open several r10c
 * sessions — the same browser signing in to more than one app, or signing in
 * again without the provider prompting. Ending it at the provider must end all
 * of them.
 *
 * Deliberately not folded into {@link IdTokenStore}, close as the two look: that
 * one holds a bearer credential with a single reader, read-and-forget; this one
 * holds our own ids, and its reader is a request arriving from outside.
 */
export interface ProviderSessionIndex {
  link(providerSessionId: string, sessionId: string): Effect.Effect<void>;
  /**
   * Read and forget: a provider that retries a logout token — and Zitadel will —
   * must find nothing the second time rather than revoke a session reopened
   * since.
   */
  take(providerSessionId: string): Effect.Effect<readonly string[]>;
}

export class ProviderSessionIndexTag extends Context.Tag(
  'ProviderSessionIndexTag',
)<ProviderSessionIndexTag, ProviderSessionIndex>() {}

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
 * Ids of sessions r10c revoked itself (`logout`, revoke-others, the admin path)
 * are left in the set on purpose. Revoking an already-revoked session is a
 * no-op, and unlinking would mean threading this store through every revocation
 * site to buy nothing.
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
      Effect.catchAll(() => Effect.void),
    ),
  take: providerSessionId =>
    Effect.tryPromise(async () => {
      const members = await redis.smembers(key(providerSessionId));
      await redis.del(key(providerSessionId));
      return members;
    }).pipe(Effect.catchAll(() => Effect.succeed([] as readonly string[]))),
});

/** Provides {@link ProviderSessionIndexTag} from the same Redis the sessions use. */
export const ProviderSessionIndexLayer = Layer.effect(
  ProviderSessionIndexTag,
  Effect.map(RedisTag, makeRedisProviderSessionIndex),
);
