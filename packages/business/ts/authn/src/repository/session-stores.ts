import { Context, type Effect } from 'effect';

/**
 * The provider's `id_token` for each r10c session, kept for RP-initiated
 * logout: ending a session at the provider needs the token it issued. `take`
 * reads and forgets in one step — a logout that runs twice must not replay it.
 */
export interface IdTokenStore {
  remember(sessionId: string, idToken: string): Effect.Effect<void>;
  take(sessionId: string): Effect.Effect<string | undefined>;
}

export class IdTokenStoreTag extends Context.Service<
  IdTokenStoreTag,
  IdTokenStore
>()('IdTokenStoreTag') {}

/**
 * The provider's session id (`sid`) to the r10c sessions it opened — the
 * index back-channel logout needs, because the provider names its own session
 * and never ours (ADR 0017). `take` empties the entry as it reads it.
 */
export interface ProviderSessionIndex {
  link(providerSessionId: string, sessionId: string): Effect.Effect<void>;
  take(providerSessionId: string): Effect.Effect<readonly string[]>;
}

export class ProviderSessionIndexTag extends Context.Service<
  ProviderSessionIndexTag,
  ProviderSessionIndex
>()('ProviderSessionIndexTag') {}

/**
 * How far the lifecycle reconciler has read the provider's user events
 * (ADR 0019). `read` answers where the next pass starts — never the future,
 * and with an overlap, because a missed deactivation is a session that
 * outlives its user.
 */
export interface LifecycleCursor {
  read: Effect.Effect<string>;
  write(at: string): Effect.Effect<void>;
}

export class LifecycleCursorTag extends Context.Service<
  LifecycleCursorTag,
  LifecycleCursor
>()('LifecycleCursorTag') {}

/**
 * What a session's token carries about who the user is acting as: the active
 * organization, the party role — **routing context, never a grant**
 * (ADR 0015) — and what that organization is entitled to (ADR 0037).
 *
 * `partyRole` is a plain string here: the closed set is
 * `party-management`'s, which this domain may not import, and the resolver
 * that reads the store narrows to it.
 */
export interface SessionScope {
  readonly organizationId?: string;
  readonly partyRole: string;
  readonly partyId?: string;
  readonly entitlements: readonly string[];
}

/** One organization a party is a member of, as the switcher lists it. */
export interface MembershipChoice {
  readonly organizationId: string;
  /** The organization's display name; absent when its record is missing. */
  readonly name?: string;
  readonly isDefault: boolean;
}

export interface SessionScopeResolver {
  /** What a session opens as at sign-in: the default membership's scope. */
  readonly forUser: (userId: string) => Effect.Effect<SessionScope>;
  /**
   * What a session opens as in one named organization, or `undefined` when the
   * user holds no membership there. The membership is the authority: an
   * organization id in a request is never a scope by itself.
   */
  readonly forMembership: (
    userId: string,
    organizationId: string,
  ) => Effect.Effect<SessionScope | undefined>;
  /** Every organization the user is a member of, default first. */
  readonly membershipsOf: (
    userId: string,
  ) => Effect.Effect<readonly MembershipChoice[]>;
}

export class SessionScopeResolverTag extends Context.Service<
  SessionScopeResolverTag,
  SessionScopeResolver
>()('SessionScopeResolverTag') {}
