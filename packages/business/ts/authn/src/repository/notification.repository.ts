import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * The account-security events a user is told about.
 *
 * Deliberately a closed set rather than free text: every one of these is
 * something the account owner needs to be able to act on, and the adapter
 * chooses the wording per locale. A notification the user cannot act on trains
 * them to ignore the ones they can.
 */
export const NotificationKind = {
  /** A sign-in from a browser this user has not been seen on before. */
  NewDevice: 'new-device',
  /** The password was changed — by them, or by someone who had their session. */
  PasswordChanged: 'password-changed',
  /** A password reset was requested; carries the single-use link. */
  PasswordReset: 'password-reset',
  /** Every session was ended. */
  SessionsRevoked: 'sessions-revoked',
  /** Sign-ins were refused for a while after repeated failures. */
  AccountLocked: 'account-locked',
} as const;

export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

export interface Notification {
  readonly kind: NotificationKind;
  readonly userId: EntityId;
  /** Where to send it — an email address or similar identifier value. */
  readonly to: string;
  /**
   * Values the message is rendered from (device label, reset link, …).
   *
   * A reset link lives here and NOWHERE in an HTTP response body: returning it
   * to the caller would hand anyone who can guess an email address a working
   * password reset.
   */
  readonly data?: Readonly<Record<string, string>>;
}

/**
 * Outbound account notifications.
 *
 * A port because the fleet has no mail transport yet: development logs and
 * records them, and a real provider becomes one adapter later without any
 * use-case changing.
 */
export interface NotificationPort {
  send(notification: Notification): Effect<void, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link NotificationPort}. */
export class NotificationPortTag extends Context.Tag('NotificationPortTag')<
  NotificationPortTag,
  NotificationPort
>() {}
