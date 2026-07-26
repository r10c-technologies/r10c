import { OneTimeTokenStoreTag } from '@r10c/entifix-ts-business';
import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { UserStatus } from '../../entities/user-identity/index.js';
import {
  AccountRepositoryTag,
  NotificationPortTag,
} from '../../repository/index.js';
import {
  RequestPasswordResetInputTag,
  requestPasswordResetUCFactory,
} from './request-password-reset.uc.js';

const unused = () => Effect.fail(new EntifixLogicError('not used here'));

const userLike = (status: UserStatus) => ({ id: 'u-1', status });

const accountsWith = (
  user: ReturnType<typeof userLike> | null,
  contact: string | null,
) =>
  AccountRepositoryTag.of({
    findByIdentifier: () => Effect.succeed(user),
    findById: unused,
    findContactAddress: () => Effect.succeed(contact),
    readPasswordHash: unused,
    writePasswordHash: unused,
    createAccount: unused,
    updateUserAspects: unused,
  } as never);

const run = (
  accounts: ReturnType<typeof accountsWith>,
  send = vi.fn(() => Effect.void),
  issue = vi.fn(() => Effect.succeed('plaintext-token')),
) =>
  Effect.runPromiseExit(
    requestPasswordResetUCFactory().pipe(
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(
        OneTimeTokenStoreTag,
        OneTimeTokenStoreTag.of({ issue, consume: unused } as never),
      ),
      Effect.provideService(
        NotificationPortTag,
        NotificationPortTag.of({ send } as never),
      ),
      Effect.provideService(RequestPasswordResetInputTag, {
        identifier: 'ada@example.com',
        resetUrlBase: 'https://auth.test',
      }),
    ),
  ).then(exit => ({ exit, send, issue }));

describe('requestPasswordResetUCFactory', () => {
  it('emails a link carrying the plaintext token', async () => {
    const { exit, send } = await run(
      accountsWith(userLike(UserStatus.Active), 'ada@example.com'),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'password-reset',
        to: 'ada@example.com',
        data: expect.objectContaining({
          link: 'https://auth.test/reset-password?token=plaintext-token',
        }),
      }),
    );
  });

  it('succeeds silently for an identifier nobody owns', async () => {
    const { exit, send, issue } = await run(accountsWith(null, null));

    // Same answer as the hit case: a difference here is how an attacker learns
    // who has an account.
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('succeeds silently for a suspended account', async () => {
    const { exit, send } = await run(
      accountsWith(userLike(UserStatus.Suspended), 'ada@example.com'),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('succeeds silently when there is nowhere to send it', async () => {
    const { exit, send, issue } = await run(
      accountsWith(userLike(UserStatus.Active), null),
    );

    // "That account has no email" is the enumeration leak by another route.
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('url-encodes the token into the link', async () => {
    const { send } = await run(
      accountsWith(userLike(UserStatus.Active), 'ada@example.com'),
      vi.fn(() => Effect.void),
      vi.fn(() => Effect.succeed('a+b/c=')),
    );

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          link: 'https://auth.test/reset-password?token=a%2Bb%2Fc%3D',
        }),
      }),
    );
  });
});
