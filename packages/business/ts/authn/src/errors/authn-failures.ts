import { Failure } from '@entifix/core';
import { Schema } from 'effect';

/**
 * What authn refuses, as failures whose `code` is the `errors` catalog key the
 * browser renders (ADR 0064). Each class is a sentence an operator or a
 * visitor can act on; none carries a cause, so nothing a driver said reaches a
 * response body.
 */

/** No account answers to what was presented, or it is not one we can sign in. */
export class InvalidCredentials extends Failure.unauthenticated<InvalidCredentials>()(
  'InvalidCredentials',
  'invalidCredentials',
  {},
  { message: () => 'invalid credentials' },
) {}

/**
 * A callback whose `state` is unknown, expired or already spent — the CSRF
 * check and the replay check in one.
 */
export class InvalidState extends Failure.unauthenticated<InvalidState>()(
  'InvalidState',
  'invalidState',
  {},
  { message: () => 'the authorization state is unknown or spent' },
) {}

/** The account exists and is not active. */
export class AccountInactive extends Failure.unauthenticated<AccountInactive>()(
  'AccountInactive',
  'accountInactive',
  {},
  { message: () => 'the account is not active' },
) {}

/**
 * A refresh against a session that was revoked, went idle past its window or
 * reached its ceiling — where the short token lifetime becomes revocation.
 */
export class SessionExpired extends Failure.unauthenticated<SessionExpired>()(
  'SessionExpired',
  'sessionExpired',
  {},
  { message: () => 'session expired' },
) {}

/** An opaque session id that resolves to nobody. */
export class SessionUnresolved extends Failure.unauthenticated<SessionUnresolved>()(
  'SessionUnresolved',
  'sessionUnresolved',
  {},
  { message: () => 'session could not be resolved' },
) {}

/**
 * A flow request missing what it cannot proceed without, or a logout token
 * that does not verify — loud, so a misconfigured provider is noticed.
 */
export class InvalidRequest extends Failure.invalid<InvalidRequest>()(
  'InvalidRequest',
  'invalidRequest',
  { reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

export class IdentifierRequired extends Failure.invalid<IdentifierRequired>()(
  'IdentifierRequired',
  'identifierRequired',
  {},
  { message: () => 'an account needs at least one identifier' },
) {}

export class EmailRequired extends Failure.invalid<EmailRequired>()(
  'EmailRequired',
  'emailRequired',
  {},
  { message: () => 'an email identifier is required' },
) {}

export class UnknownRole extends Failure.invalid<UnknownRole>()(
  'UnknownRole',
  'unknownRole',
  {},
  { message: () => 'unknown role' },
) {}

export class UnknownStatus extends Failure.invalid<UnknownStatus>()(
  'UnknownStatus',
  'unknownStatus',
  {},
  { message: () => 'unknown status' },
) {}

export class NothingToUpdate extends Failure.invalid<NothingToUpdate>()(
  'NothingToUpdate',
  'nothingToUpdate',
  {},
  { message: () => 'nothing to update' },
) {}

export class UserNotFound extends Failure.notFound<UserNotFound>()(
  'UserNotFound',
  'userNotFound',
  { userId: Schema.String },
  { message: ({ userId }) => `no user ${userId}` },
) {}

/**
 * Authenticated, but not permitted: assigning a role above the actor's own
 * tier. Which rule refused is safe to say — knowing it reveals nothing the
 * caller could not infer.
 */
export class RoleNotAllowed extends Failure.forbidden<RoleNotAllowed>()(
  'RoleNotAllowed',
  'roleNotAllowed',
  { role: Schema.String },
  { message: () => 'not allowed to assign that role' },
) {}

/** Editing a user who outranks the actor. */
export class UserNotAllowed extends Failure.forbidden<UserNotAllowed>()(
  'UserNotAllowed',
  'userNotAllowed',
  { role: Schema.String },
  { message: () => 'not allowed to modify that user' },
) {}

/** Demoting or deactivating oneself. */
export class SelfRoleChange extends Failure.forbidden<SelfRoleChange>()(
  'SelfRoleChange',
  'selfRoleChange',
  {},
  { message: () => 'cannot change your own role or status' },
) {}

/** An identifier value another account already holds. */
export class IdentifierInUse extends Failure.conflict<IdentifierInUse>()(
  'IdentifierInUse',
  'identifierInUse',
  {},
  { message: () => 'identifier already in use' },
) {}

/**
 * A first sign-in the domain refused to provision — an identifier the
 * provider vouches for that another account already holds. Named apart from
 * the refusal itself, so the visitor reads "sign-in failed" rather than an
 * administrator's sentence.
 */
export class SignInFailed extends Failure.conflict<SignInFailed>()(
  'SignInFailed',
  'signInFailed',
  {},
  { message: () => 'sign-in could not be resolved' },
) {}

/**
 * The provider would not hold the human for an account just created here.
 * The local record stands with no external subject: it cannot sign in, and
 * submitting the same form again repairs it (ADR 0016).
 */
export class ProviderUnavailable extends Failure.conflict<ProviderUnavailable>()(
  'ProviderUnavailable',
  'providerUnavailable',
  {},
  { message: () => 'the identity provider could not be provisioned' },
) {}
