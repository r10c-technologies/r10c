import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * The account-security events a user is told about **by r10c**.
 *
 * Deliberately a closed set rather than free text: every one of these is
 * something the account owner needs to be able to act on, and the adapter
 * chooses the wording per locale. A notification the user cannot act on trains
 * them to ignore the ones they can.
 *
 * Short, because it only covers what r10c still knows about. Password changes,
 * recovery links, email verification and lockout are Zitadel's mail now — it
 * owns the credential, so it is the only side that can see those events at all.
 * What is left is what r10c uniquely observes: the devices a session was opened
 * from, and its own revocations.
 */
export const NotificationKind = {
  /** A sign-in from a browser this user has not been seen on before. */
  NewDevice: 'new-device',
  /**
   * An administrator ended every one of this user's sessions.
   *
   * Worth telling them precisely because they did not do it: being signed out
   * everywhere with no explanation is indistinguishable from an account
   * compromise, and a person who cannot tell those apart cannot report either.
   */
  SessionsRevoked: 'sessions-revoked',
} as const;

export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];

export interface Notification {
  readonly kind: NotificationKind;
  readonly userId: EntityId;
  /** Where to send it — an email address or similar identifier value. */
  readonly to: string;
  /**
   * Values the message is rendered from — a device label, a browser, an IP.
   *
   * Everything here is safe to put in a message body, which is now true by
   * construction rather than by care: the one value that was not — a password
   * reset link, which had to exist in the notification and nowhere else —
   * belongs to Zitadel, and r10c never sees one.
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
