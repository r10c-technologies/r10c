import { OneTimeTokenStoreTag } from '@r10c/entifix-ts-business';
import { Context, Effect } from 'effect';

import { UserStatus } from '../../entities/user-identity';
import {
  AccountRepositoryTag,
  NotificationKind,
  NotificationPortTag,
} from '../../repository';

/** Someone asking for a reset link, by any identifier they remember. */
export interface RequestPasswordResetInput {
  readonly identifier: string;
  /** Base URL the emailed link is built from, e.g. `https://auth.example`. */
  readonly resetUrlBase: string;
}

export class RequestPasswordResetInputTag extends Context.Tag(
  'RequestPasswordResetInputTag',
)<RequestPasswordResetInputTag, RequestPasswordResetInput>() {}

/** Token purpose namespace — a reset token cannot be redeemed as anything else. */
export const PASSWORD_RESET_PURPOSE = 'password-reset';

/** Long enough to read an email, short enough to bound a leaked link. */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 15;

/**
 * Start password recovery.
 *
 * **Always succeeds**, whether or not the identifier exists, whether or not the
 * account is active, and whether or not it has a contact address. The caller
 * gets the same answer every time and cannot use this endpoint to discover who
 * has an account here — which is what a differing response, or even a
 * noticeably different response *time*, would hand them.
 *
 * The token is minted by the store, which keeps only its hash; the plaintext
 * exists in the emailed link and nowhere else — never in an HTTP response.
 *
 * Framework-free: it yields tags the shell binds and knows nothing of Redis,
 * mail, or HTTP.
 */
export function requestPasswordResetUCFactory() {
  return Effect.gen(function* () {
    const { identifier, resetUrlBase } = yield* RequestPasswordResetInputTag;
    const accounts = yield* AccountRepositoryTag;
    const tokens = yield* OneTimeTokenStoreTag;
    const notifications = yield* NotificationPortTag;

    const user = yield* accounts.findByIdentifier(identifier);
    if (user === null || user.status !== UserStatus.Active) {
      return;
    }

    const to = yield* accounts.findContactAddress(user.id);
    if (to === null) {
      // Nothing to send it to. Silence is correct: telling the caller "that
      // account has no email" is the enumeration leak by another route.
      return;
    }

    const token = yield* tokens.issue(
      PASSWORD_RESET_PURPOSE,
      String(user.id),
      PASSWORD_RESET_TTL_SECONDS,
    );

    yield* notifications.send({
      kind: NotificationKind.PasswordReset,
      userId: user.id,
      to,
      data: {
        link: `${resetUrlBase}/reset-password?token=${encodeURIComponent(token)}`,
        expiresInMinutes: String(PASSWORD_RESET_TTL_SECONDS / 60),
      },
    });
  });
}
