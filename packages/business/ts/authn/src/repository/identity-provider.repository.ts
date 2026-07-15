import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
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
  resolveSession(sessionId: string): Effect<Principal, EntifixError>;

  /**
   * Resolve a presented identifier (email / username / IdP subject) to its
   * canonical user. The `type`/`value` pair matches an {@link EntityIdentifier}.
   */
  resolveIdentifier(
    type: string,
    value: string
  ): Effect<UserIdentity, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link IdentityProvider}. */
export class IdentityProviderTag extends Context.Tag('IdentityProviderTag')<
  IdentityProviderTag,
  IdentityProvider
>() {}

/** Input tag: the opaque session id a use-case operates on, provided per call. */
export class SessionIdTag extends Context.Tag('SessionIdTag')<
  SessionIdTag,
  string
>() {}

/** Input tag: a canonical user id, provided per call. */
export class UserIdTag extends Context.Tag('UserIdTag')<
  UserIdTag,
  EntityId
>() {}
