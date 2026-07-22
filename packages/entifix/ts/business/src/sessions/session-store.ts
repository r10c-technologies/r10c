import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * The subject state a session carries. Deliberately structural (no `Principal`
 * import — that lives in the authn layer above this one) so any domain can
 * store its authenticated subject here. A resolved `Principal` is assignable to
 * it as-is.
 */
export interface SessionData {
  readonly userId: EntityId;
  /** Upstream identity subject (e.g. an IdP `sub`, or the canonical user id). */
  readonly subject: string;
  readonly roles: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** A stored session as read back — {@link SessionData} plus lifecycle metadata. */
export interface SessionRecord extends SessionData {
  /** The opaque session id this record is keyed by; the revocation handle. */
  readonly sessionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
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
  create(data: SessionData, ttlSeconds: number): Effect<string, EntifixError>;
  /** Read a live session, failing if it is unknown, revoked, or expired. */
  read(sessionId: string): Effect<SessionRecord, EntifixError>;
  /** Extend a live session's TTL (sliding-window renewal). */
  touch(sessionId: string, ttlSeconds: number): Effect<void, EntifixError>;
  /** Revoke a single session — the next {@link read} fails immediately. */
  revoke(sessionId: string): Effect<void, EntifixError>;
  /** Revoke every session for a user (e.g. password change, admin kick). */
  revokeAllForUser(userId: EntityId): Effect<void, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link SessionStore}. */
export class SessionStoreTag extends Context.Tag('SessionStoreTag')<
  SessionStoreTag,
  SessionStore
>() {}
