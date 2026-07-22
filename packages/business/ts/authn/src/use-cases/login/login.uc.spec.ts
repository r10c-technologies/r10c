import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { UserIdentity, UserStatus } from '../../entities/user-identity/index.js';
import {
  AccountRepositoryTag,
  PasswordHasherTag,
} from '../../repository/index.js';
import { LoginInputTag, loginUCFactory } from './login.uc.js';

const userNamed = (status: UserStatus = UserStatus.Active): UserIdentity => {
  const user = new UserIdentity();
  user.id = 'user-1';
  user.displayName = 'Ada Lovelace';
  user.status = status;
  return user;
};

interface StubAccount {
  user?: UserIdentity | null;
  hash?: string | null;
}

const stubAccounts = ({ user = null, hash = null }: StubAccount) =>
  AccountRepositoryTag.of({
    findByIdentifier: () => Effect.succeed(user),
    readPasswordHash: () => Effect.succeed(hash),
    createAccount: () =>
      Effect.fail(new EntifixLogicError('not used in login')),
  });

const stubHasher = (matches: boolean) =>
  PasswordHasherTag.of({
    hash: () => Effect.succeed('unused'),
    verify: () => Effect.succeed(matches),
  });

const runLogin = (
  accounts: ReturnType<typeof stubAccounts>,
  hasher: ReturnType<typeof stubHasher>,
) =>
  Effect.runPromiseExit(
    loginUCFactory().pipe(
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(PasswordHasherTag, hasher),
      Effect.provideService(LoginInputTag, {
        identifier: 'ada@example.com',
        password: 'correct-horse',
      }),
    ),
  );

describe('loginUCFactory', () => {
  it('returns the auth subject when credentials are valid', async () => {
    const exit = await runLogin(
      stubAccounts({ user: userNamed(), hash: 'stored-hash' }),
      stubHasher(true),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        userId: 'user-1',
        subject: 'user-1',
        roles: [],
        attributes: { displayName: 'Ada Lovelace', status: UserStatus.Active },
      });
    }
  });

  it.each([
    ['an unknown identifier', stubAccounts({ user: null }), stubHasher(true)],
    [
      'an inactive user',
      stubAccounts({ user: userNamed(UserStatus.Suspended), hash: 'h' }),
      stubHasher(true),
    ],
    [
      'a user with no credential',
      stubAccounts({ user: userNamed(), hash: null }),
      stubHasher(true),
    ],
    [
      'a wrong password',
      stubAccounts({ user: userNamed(), hash: 'stored-hash' }),
      stubHasher(false),
    ],
  ])('fails with UnauthenticatedError for %s', async (_label, accounts, hasher) => {
    const exit = await runLogin(accounts, hasher);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
      expect(exit.cause.error._tag).toBe('UnauthenticatedError');
    }
  });
});
