import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * The claims a stateless access token carries between the perimeter that mints
 * it and the services that verify it. Kept small on purpose: everything here is
 * copied into every request and can only refresh when a new token is minted, so
 * only authorization-critical, stable subject data belongs in it. Richer or
 * volatile state stays in the session record and is read on demand.
 */
export interface TokenClaims {
  /** Canonical user id — the value services key their data against. */
  readonly userId: EntityId;
  /** Upstream identity subject that authenticated the session. */
  readonly subject: string;
  /** The session id the token was minted from; the revocation linkage. */
  readonly sessionId: string;
  readonly roles: readonly string[];
  /**
   * The organization this session is acting for, and the value every
   * tenant-plane storage handle is resolved from.
   *
   * A property of the **session**, not of the user: a party may hold several
   * memberships, and switching re-mints the token. Absent for a session with no
   * organization — a buyer, or an operator, who holds no tenant scope at all.
   *
   * Note this is a *routing* key, not an authorization input. Grants still come
   * from `roles` resolved at the consumer.
   */
  readonly activeOrganizationId?: string;
  /**
   * Which population the session belongs to — a buyer, a vendor's staff, or
   * platform staff. Typed as a plain string here because the closed set lives
   * in the business layer (`PartyRoles` in `business-ts-party-management`),
   * which this layer may not import; consumers narrow it, exactly as they
   * already do for `roles`.
   *
   * It exists because the alternative was inferring it from an *absent*
   * `activeOrganizationId`, which cannot tell a buyer from an operator — two
   * populations whose reach differs enormously. A capability that sensitive
   * must not be signalled by a missing field.
   *
   * Like `activeOrganizationId` this is routing/context, not a grant: what a
   * principal may do still comes from `roles` resolved at the consumer.
   */
  readonly partyRole?: string;
  /** Room for a few extra stable claims without a type change. */
  readonly [key: string]: unknown;
}

/**
 * Signs and verifies short-lived access tokens. The perimeter provides it to
 * mint a token from a resolved session; every downstream service provides it to
 * verify one statelessly (no store round trip on the hot path). Vendor-neutral:
 * a `jose`/HS256 adapter backs it now, an RS256/JWKS one can later without
 * touching a consumer.
 */
export interface TokenService {
  /** Sign the claims into a compact token that expires after `ttlSeconds`. */
  sign(claims: TokenClaims, ttlSeconds: number): Effect<string, EntifixError>;
  /** Verify signature + expiry and return the claims, or fail. */
  verify(token: string): Effect<TokenClaims, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link TokenService}. */
export class TokenServiceTag extends Context.Tag('TokenServiceTag')<
  TokenServiceTag,
  TokenService
>() {}
