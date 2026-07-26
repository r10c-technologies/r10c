import type { EntityId } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import { AuthnError, UnauthenticatedError } from '../../errors';
import { AccountRepositoryTag, PasswordHasherTag } from '../../repository';

/** A signed-in user changing their own password. */
export interface ChangePasswordInput {
  readonly userId: EntityId;
  /** Re-presented to prove the person at the keyboard is the account owner. */
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** Input tag: the change request, provided per call. */
export class ChangePasswordInputTag extends Context.Tag(
  'ChangePasswordInputTag',
)<ChangePasswordInputTag, ChangePasswordInput>() {}

/** Shortest password the domain will store. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Change a signed-in user's password.
 *
 * The current password is re-verified even though the caller already holds a
 * valid session: a session can be an unlocked laptop or a stolen cookie, and
 * without this step either of those silently becomes permanent ownership of the
 * account. Holding a session proves how you got in, not who you are.
 *
 * Session revocation is deliberately NOT done here — the caller decides which
 * sessions survive, because the route knows which one is the caller's own and
 * this use-case does not.
 *
 * Framework-free: it yields tags the shell binds and touches no store directly.
 */
export function changePasswordUCFactory() {
  return Effect.gen(function* () {
    const { userId, currentPassword, newPassword } =
      yield* ChangePasswordInputTag;
    const accounts = yield* AccountRepositoryTag;
    const hasher = yield* PasswordHasherTag;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return yield* Effect.fail(
        new AuthnError('password too short', 'passwordTooShort'),
      );
    }

    const hash = yield* accounts.readPasswordHash(userId);
    if (hash === null) {
      return yield* Effect.fail(
        new UnauthenticatedError('invalid credentials', 'passwordIncorrect'),
      );
    }

    const matches = yield* hasher.verify(currentPassword, hash);
    if (!matches) {
      // A distinct code from login's: the caller is authenticated, so telling
      // them their *current* password was wrong reveals nothing they do not
      // already know, and "invalid credentials" here reads as a bug.
      return yield* Effect.fail(
        new UnauthenticatedError('current password is wrong', 'passwordIncorrect'),
      );
    }

    const next = yield* hasher.hash(newPassword);
    yield* accounts.writePasswordHash(userId, next);
  });
}
