import { Context } from 'effect';

/**
 * How long an access token this deployment mints lives.
 *
 * A port rather than the constant it used to be, because it is a dial: a live
 * pass shortens it to watch a push stream reauthenticate before `exp`, and an
 * operator tightens it to bound how long a revoked session keeps working. The
 * slice shell reads the `session.accessTokenTtlSeconds` row and provides it;
 * {@link ACCESS_TOKEN_TTL_SECONDS} is only the value that row is seeded with.
 *
 * Both the signature's `exp` and the `expiresIn` a client schedules its next
 * refresh from are read from here, so the two can never disagree.
 */
export interface AccessTokenLifetime {
  readonly seconds: number;
}

export class AccessTokenLifetimeTag extends Context.Service<
  AccessTokenLifetimeTag,
  AccessTokenLifetime
>()('AccessTokenLifetimeTag') {}
