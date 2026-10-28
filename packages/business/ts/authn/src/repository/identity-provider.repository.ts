import type { EntityId, TransitionalFailure } from '@entifix/core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

import type { UserIdentity } from '../entities/user-identity';
import type { Principal } from '../values';

/**
 * The perimeter's view of an identity provider — framework- and vendor-neutral.
 * A shell implements it over whatever backs identity (Zitadel session API +
 * Redis cache on the gateway, a stub in tests), and provides it through
 * {@link IdentityProviderTag}. Use-cases yield the tag rather than importing an
 * SDK, so swapping the provider is a composition-root change only.
 */
export interface IdentityProvider {
  /** Resolve an opaque session id to the authenticated {@link Principal}. */
  resolveSession(sessionId: string): Effect<Principal, TransitionalFailure>;

  /**
   * Resolve a presented identifier (email / username / IdP subject) to its
   * canonical user. The `type`/`value` pair matches an {@link EntityIdentifier}.
   */
  resolveIdentifier(
    type: string,
    value: string,
  ): Effect<UserIdentity, TransitionalFailure>;
}

/** DI tag the composition root binds to a concrete {@link IdentityProvider}. */
export class IdentityProviderTag extends Context.Service<
  IdentityProviderTag,
  IdentityProvider
>()('IdentityProviderTag') {}

/** Input tag: the opaque session id a use-case operates on, provided per call. */
export class SessionIdTag extends Context.Service<SessionIdTag, string>()(
  'SessionIdTag',
) {}

/** Input tag: a canonical user id, provided per call. */
export class UserIdTag extends Context.Service<UserIdTag, EntityId>()(
  'UserIdTag',
) {}

/**
 * Request-scoped tag carrying the {@link Principal} a request was authenticated
 * as. A service's auth middleware verifies the access token and provides it;
 * downstream handlers yield it instead of re-parsing the token.
 */
export class PrincipalTag extends Context.Service<PrincipalTag, Principal>()(
  'PrincipalTag',
) {}
