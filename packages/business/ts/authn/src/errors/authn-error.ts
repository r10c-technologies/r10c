import { EntifixError } from '@r10c/entifix-ts-core';

/**
 * Raised when a session cannot be resolved to a {@link Principal} — expired,
 * revoked, unknown, or never authenticated. Kept in the {@link EntifixError}
 * hierarchy so authn use-cases fail on the same error channel as the rest of
 * the domain and shells can pattern-match on `_tag`.
 */
export class UnauthenticatedError extends EntifixError {
  override _tag = 'UnauthenticatedError';
}

/**
 * Raised when an identity provider or identifier operation fails for a reason
 * other than the subject simply not being authenticated (e.g. a linking rule
 * was violated, or the provider is unreachable).
 */
export class AuthnError extends EntifixError {
  override _tag = 'AuthnError';
}

/**
 * Raised when the caller is authenticated but not permitted to do what it
 * asked — assigning a role above its own tier, editing a user who outranks it,
 * demoting itself.
 *
 * Distinct from {@link AuthnError} because the two mean opposite things to a
 * client and map to different statuses. Collapsing them is how a refused
 * promotion came back as `409 identifier already in use`.
 */
export class ForbiddenError extends EntifixError {
  override _tag = 'ForbiddenError';
}
