import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountRepositoryTag,
  PasswordHasherTag,
} from '../../repository/index.js';
import {
  ChangePasswordInputTag,
  changePasswordUCFactory,
} from './change-password.uc.js';

const unused = () => Effect.fail(new EntifixLogicError('not used here'));

const accountsWith = (
  hash: string | null,
  write = vi.fn(() => Effect.void),
) =>
  AccountRepositoryTag.of({
    findByIdentifier: unused,
    findById: unused,
    findContactAddress: unused,
    readPasswordHash: () => Effect.succeed(hash),
    writePasswordHash: write as never,
    createAccount: unused,
    updateUserAspects: unused,
  } as never);

const hasherThatAccepts = (matches: boolean) =>
  PasswordHasherTag.of({
    hash: (plain: string) => Effect.succeed(`hashed:${plain}`),
    verify: () => Effect.succeed(matches),
  });

const run = (
  input: { currentPassword: string; newPassword: string },
  accounts: ReturnType<typeof accountsWith>,
  matches = true,
) =>
  Effect.runPromiseExit(
    changePasswordUCFactory().pipe(
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(PasswordHasherTag, hasherThatAccepts(matches)),
      Effect.provideService(ChangePasswordInputTag, { userId: 'u-1', ...input }),
    ),
  );

describe('changePasswordUCFactory', () => {
  it('stores the hash of the new password', async () => {
    const write = vi.fn(() => Effect.void);
    const exit = await run(
      { currentPassword: 'old-password', newPassword: 'new-password' },
      accountsWith('hash-of-old', write),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    // The store never sees plaintext.
    expect(write).toHaveBeenCalledWith('u-1', 'hashed:new-password');
  });

  it('refuses when the current password is wrong', async () => {
    const write = vi.fn(() => Effect.void);
    const exit = await run(
      { currentPassword: 'not-it', newPassword: 'new-password' },
      accountsWith('hash-of-old', write),
      false,
    );

    // Re-verifying matters: a session can be an unlocked laptop or a stolen
    // cookie, and without this either becomes permanent ownership.
    expect(Exit.isFailure(exit)).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('reports a wrong current password distinctly from a bad login', async () => {
    const exit = await run(
      { currentPassword: 'not-it', newPassword: 'new-password' },
      accountsWith('hash-of-old'),
      false,
    );

    // The caller is already authenticated, so "invalid credentials" would read
    // as a bug rather than as an answer.
    expect(Exit.isFailure(exit) && (exit.cause as never)).toBeTruthy();
    const failure = Exit.isFailure(exit)
      ? ((exit.cause as unknown as { error: { code: string } }).error)
      : undefined;
    expect(failure?.code).toBe('passwordIncorrect');
  });

  it('refuses a password shorter than the minimum', async () => {
    const write = vi.fn(() => Effect.void);
    const exit = await run(
      { currentPassword: 'old-password', newPassword: 'short' },
      accountsWith('hash-of-old', write),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses when the account has no credential at all', async () => {
    const exit = await run(
      { currentPassword: 'old-password', newPassword: 'new-password' },
      accountsWith(null),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
