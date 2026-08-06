import { RedisTag } from '@r10c/entifix-ts-redis-client';
import { Context, Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

import { SESSION_ABSOLUTE_TTL_SECONDS } from './session-policy';

/**
 * Remembers the `id_token` a session was opened with, keyed by session id.
 *
 * It exists for exactly one thing: RP-initiated logout needs an
 * `id_token_hint`, and without one Zitadel cannot tell which session to end and
 * asks the user to confirm — turning sign-out into a page nobody expects.
 *
 * Deliberately **not** carried in the session's `attributes` bag, even though
 * that would have been free. Those attributes travel into every `Principal` the
 * service returns, including `GET /api/me`, which a Next server layout hands to
 * the browser. An `id_token` is a bearer credential at the provider; the one
 * place it must not end up is a page payload.
 */
export interface IdTokenStore {
  remember(sessionId: string, idToken: string): Effect.Effect<void>;
  /** Read and forget in one step — a logout is the only reader, and it is final. */
  take(sessionId: string): Effect.Effect<string | undefined>;
}

export class IdTokenStoreTag extends Context.Tag('IdTokenStoreTag')<
  IdTokenStoreTag,
  IdTokenStore
>() {}

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
      Effect.catchAll(() => Effect.void),
    ),
  take: sessionId =>
    Effect.tryPromise(() => redis.getdel(key(sessionId))).pipe(
      Effect.map(value => value ?? undefined),
      Effect.catchAll(() => Effect.succeed(undefined)),
    ),
});

/** Provides {@link IdTokenStoreTag} from the same Redis the sessions use. */
export const IdTokenStoreLayer = Layer.effect(
  IdTokenStoreTag,
  Effect.map(RedisTag, makeRedisIdTokenStore),
);
