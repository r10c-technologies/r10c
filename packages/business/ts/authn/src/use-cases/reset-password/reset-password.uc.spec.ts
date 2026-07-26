import { OneTimeTokenStoreTag } from '@r10c/entifix-ts-business';
import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountRepositoryTag,
  PasswordHasherTag,
} from '../../repository/index.js';
import {
  ResetPasswordInputTag,
  resetPasswordUCFactory,
} from './reset-password.uc.js';

const unused = () => Effect.fail(new EntifixLogicError('not used here'));

const codeOf = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  Exit.isFailure(exit)
    ? (exit.cause as unknown as { error?: { code?: string } }).error?.code
    : undefined;

const run = (
  newPassword: string,
  consume: () => Effect.Effect<string, EntifixLogicError>,
  write = vi.fn(() => Effect.void),
) =>
  Effect.runPromiseExit(
    resetPasswordUCFactory().pipe(
      Effect.provideService(
        AccountRepositoryTag,
        AccountRepositoryTag.of({
          findByIdentifier: unused,
          findById: unused,
          findContactAddress: unused,
          readPasswordHash: unused,
          writePasswordHash: write as never,
          createAccount: unused,
          updateUserAspects: unused,
        } as never),
      ),
      Effect.provideService(
        PasswordHasherTag,
        PasswordHasherTag.of({
          hash: (plain: string) => Effect.succeed(`hashed:${plain}`),
          verify: () => Effect.succeed(true),
        }),
      ),
      Effect.provideService(
        OneTimeTokenStoreTag,
        OneTimeTokenStoreTag.of({ issue: unused, consume } as never),
      ),
      Effect.provideService(ResetPasswordInputTag, {
        token: 'a-token',
        newPassword,
      }),
    ),
  ).then(exit => ({ exit, write }));

describe('resetPasswordUCFactory', () => {
  it('sets the new password and reports whose it was', async () => {
    const { exit, write } = await run('recovered-password', () =>
      Effect.succeed('u-1'),
    );

    expect(Exit.isSuccess(exit) && exit.value).toBe('u-1');
    expect(write).toHaveBeenCalledWith('u-1', 'hashed:recovered-password');
  });

  it('refuses an unknown, expired or already-used token alike', async () => {
    const { exit, write } = await run('recovered-password', () =>
      Effect.fail(new EntifixLogicError('gone')),
    );

    // One answer for all three: telling them apart says whether a token ever
    // existed.
    expect(codeOf(exit)).toBe('invalidResetToken');
    expect(write).not.toHaveBeenCalled();
  });

  it('checks the password length before spending the token', async () => {
    const consume = vi.fn(() => Effect.succeed('u-1'));
    const { exit, write } = await run('short', consume);

    // Otherwise a mistyped short password burns the link and the user has to
    // start recovery over.
    expect(codeOf(exit)).toBe('passwordTooShort');
    expect(consume).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
