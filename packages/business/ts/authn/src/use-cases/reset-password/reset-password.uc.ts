import { OneTimeTokenStoreTag } from '@r10c/entifix-ts-business';
import type { EntityId } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import { AuthnError, UnauthenticatedError } from '../../errors';
import { AccountRepositoryTag, PasswordHasherTag } from '../../repository';
import { MIN_PASSWORD_LENGTH } from '../change-password';
import { PASSWORD_RESET_PURPOSE } from '../request-password-reset';

/** Redeeming a reset link. */
export interface ResetPasswordInput {
  readonly token: string;
  readonly newPassword: string;
}

export class ResetPasswordInputTag extends Context.Tag('ResetPasswordInputTag')<
  ResetPasswordInputTag,
  ResetPasswordInput
>() {}

/**
 * Finish password recovery, returning the user whose password was set so the
 * caller can revoke their sessions.
 *
 * The token is consumed atomically before anything else happens, so a link is
 * spent on first use — a copy sitting in a mail archive or a proxy log is
 * already worthless.
 *
 * Revocation is the caller's job, not this use-case's: recovery means the old
 * password may have been in someone else's hands, so every existing session has
 * to go. That needs the session store, which lives a layer away.
 *
 * Framework-free: it yields tags the shell binds.
 */
export function resetPasswordUCFactory() {
  return Effect.gen(function* () {
    const { token, newPassword } = yield* ResetPasswordInputTag;
    const accounts = yield* AccountRepositoryTag;
    const hasher = yield* PasswordHasherTag;
    const tokens = yield* OneTimeTokenStoreTag;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return yield* Effect.fail(
        new AuthnError('password too short', 'passwordTooShort'),
      );
    }

    const userId: EntityId = yield* tokens
      .consume(PASSWORD_RESET_PURPOSE, token)
      .pipe(
        // Unknown, expired and already-used are one answer on purpose: telling
        // them apart says whether a token ever existed.
        Effect.catchAll(() =>
          Effect.fail(
            new UnauthenticatedError('invalid reset token', 'invalidResetToken'),
          ),
        ),
      );

    const next = yield* hasher.hash(newPassword);
    yield* accounts.writePasswordHash(userId, next);
    return userId;
  });
}
