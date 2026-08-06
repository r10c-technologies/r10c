import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * The subject state a session carries. Deliberately structural (no `Principal`
 * import — that lives in the authn layer above this one) so any domain can
 * store its authenticated subject here. A resolved `Principal` is assignable to
 * it as-is.
 */
/**
 * What the session was opened from, for display and for notifying the owner.
 *
 * **A label, never an authorization input.** Every field is client-supplied or
 * client-derived, so a copied cookie copies the device — which is acceptable
 * precisely because nothing here decides anything. It powers "you are signed in
 * on these devices" and "a new device signed in"; it never grants or refuses.
 */
export interface DeviceContext {
  /** Opaque, server-minted id carried in a long-lived cookie. */
  readonly deviceId: string;
  readonly browser?: string;
  readonly os?: string;
  /** `desktop` / `mobile` / `tablet`, as the user-agent reports it. */
  readonly type?: string;
  /** Truncated to a /24 — enough for "somewhere else", less PII at rest. */
  readonly ip?: string;
}

export interface SessionData {
  readonly userId: EntityId;
  /** Upstream identity subject (e.g. an IdP `sub`, or the canonical user id). */
  readonly subject: string;
  readonly roles: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
  /**
   * The organization this session is acting for. It lives here rather than on
   * the user because a party may belong to several organizations, so switching
   * is a session operation that re-mints the access token — modelling it on the
   * user would make someone serving two vendors keep two accounts.
   *
   * Absent for a session with no organization: a buyer, or an operator, who
   * holds no tenant scope by default.
   */
  readonly activeOrganizationId?: string;
  /**
   * Which population this session belongs to — buyer, vendor staff, or platform
   * staff. Resolved once when the session opens and carried from there into
   * every access token minted from it, so no service re-derives it per request.
   *
   * A plain string for the same reason `roles` is: the closed set lives in the
   * business layer above this one.
   */
  readonly partyRole?: string;
  /** Absent for sessions opened by a non-browser caller. */
  readonly device?: DeviceContext;
}

/** A stored session as read back — {@link SessionData} plus lifecycle metadata. */
export interface SessionRecord extends SessionData {
  /** The opaque session id this record is keyed by; the revocation handle. */
  readonly sessionId: string;
  readonly createdAt: string;
  /** End of the current sliding window; moves forward on every {@link SessionStore.touch}. */
  readonly expiresAt: string;
  /**
   * The ceiling, stamped at creation and never moved. A sliding window with no
   * ceiling renews forever, so this is what guarantees every session eventually
   * ends — including one an attacker is keeping warm.
   */
  readonly absoluteExpiresAt: string;
}

/** The two durations a session is opened with. */
export interface SessionLifetimeSeconds {
  /** Sliding window, renewed on each touch. */
  readonly idleTtlSeconds: number;
  /** Ceiling measured from creation; never extended. */
  readonly absoluteTtlSeconds: number;
}

/**
 * The session persistence seam. An opaque, revocable, TTL-bounded store keyed by
 * a server-minted session id — the single source of truth every service can
 * read a live session from, and the handle an admin/logout revokes through.
 *
 * Framework- and store-agnostic: a Redis adapter backs it in production, a fake
 * in tests, and the use-cases that consume {@link SessionStoreTag} never change.
 */
export interface SessionStore {
  /** Persist a new session and return its freshly minted opaque id. */
  create(
    data: SessionData,
    lifetime: SessionLifetimeSeconds,
  ): Effect<string, EntifixError>;
  /** Read a live session, failing if it is unknown, revoked, or expired. */
  read(sessionId: string): Effect<SessionRecord, EntifixError>;
  /**
   * Renew the sliding window, **clamped to the session's own
   * {@link SessionRecord.absoluteExpiresAt}**. Fails once the ceiling is passed,
   * which is how a long-lived session finally ends.
   */
  touch(sessionId: string, idleTtlSeconds: number): Effect<void, EntifixError>;
  /**
   * Every live session a user holds.
   *
   * The read side of the index `revokeAllForUser` already walks. Without it
   * there is no way to show someone where they are signed in, and "sign out
   * everywhere" is an action with no visible subject.
   */
  listForUser(userId: EntityId): Effect<readonly SessionRecord[], EntifixError>;
  /** Revoke a single session — the next {@link read} fails immediately. */
  revoke(sessionId: string): Effect<void, EntifixError>;
  /** Revoke every session for a user (e.g. password change, admin kick). */
  revokeAllForUser(userId: EntityId): Effect<void, EntifixError>;
  /**
   * Revoke every session for a user EXCEPT one.
   *
   * What a password change should do: end every other session, but leave the
   * person who just changed it signed in. `revokeAllForUser` would log them out
   * of the screen they are standing on.
   */
  revokeAllForUserExcept(
    userId: EntityId,
    keepSessionId: string,
  ): Effect<void, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link SessionStore}. */
export class SessionStoreTag extends Context.Tag('SessionStoreTag')<
  SessionStoreTag,
  SessionStore
>() {}
