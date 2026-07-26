import { EntifixError } from '@r10c/entifix-ts-core';

/**
 * A key in the shared `errors` catalog — what the client actually shows.
 *
 * Separate from the `message`, which stays a developer-facing sentence for logs
 * and traces. Before this, `respondAuthError` passed the raw message straight
 * to the browser, so "not allowed to assign that role" *was* the UI copy, in
 * English, in every locale.
 */
export type AuthnErrorCode = string;

/**
 * Base for the authn errors that reach a user. The code sits second because it
 * is the interesting half at a call site; `cause`/`details` stay where
 * {@link EntifixError} puts them.
 */
abstract class CodedAuthnError extends EntifixError {
  readonly code?: AuthnErrorCode;

  constructor(
    message: string,
    code?: AuthnErrorCode,
    cause?: unknown,
    details?: Record<string, unknown>,
  ) {
    super(message, cause, details);
    this.code = code;
  }
}

/**
 * Raised when a session cannot be resolved to a {@link Principal} — expired,
 * revoked, unknown, or never authenticated. Kept in the {@link EntifixError}
 * hierarchy so authn use-cases fail on the same error channel as the rest of
 * the domain and shells can pattern-match on `_tag`.
 */
export class UnauthenticatedError extends CodedAuthnError {
  override _tag = 'UnauthenticatedError';
}

/**
 * Raised when an identity provider or identifier operation fails for a reason
 * other than the subject simply not being authenticated (e.g. a linking rule
 * was violated, or the provider is unreachable).
 */
export class AuthnError extends CodedAuthnError {
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
export class ForbiddenError extends CodedAuthnError {
  override _tag = 'ForbiddenError';
}
