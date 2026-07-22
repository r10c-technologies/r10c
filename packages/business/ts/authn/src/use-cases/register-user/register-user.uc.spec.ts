import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { IdentifierType } from '../../entities/entity-identifier/index.js';
import { UserIdentity, UserStatus } from '../../entities/user-identity/index.js';
import {
  AccountRepositoryTag,
  type CreateAccountInput,
  PasswordHasherTag,
} from '../../repository/index.js';
import {
  RegisterInputTag,
  registerUserUCFactory,
} from './register-user.uc.js';

const createdUser = (): UserIdentity => {
  const user = new UserIdentity();
  user.id = 'user-9';
  user.displayName = 'Grace Hopper';
  user.status = UserStatus.Active;
  return user;
};

const stubAccounts = (
  onCreate: (input: CreateAccountInput) => void = () => undefined,
) =>
  AccountRepositoryTag.of({
    findByIdentifier: () => Effect.succeed(null),
    readPasswordHash: () => Effect.succeed(null),
    createAccount: (input) => {
      onCreate(input);
      return Effect.succeed(createdUser());
    },
  });

const hasher = PasswordHasherTag.of({
  hash: (plain) => Effect.succeed(`hashed:${plain}`),
  verify: () => Effect.succeed(false),
});

const runRegister = (
  accounts: ReturnType<typeof stubAccounts>,
  identifiers: { type: IdentifierType; value: string }[],
) =>
  Effect.runPromiseExit(
    registerUserUCFactory().pipe(
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(PasswordHasherTag, hasher),
      Effect.provideService(RegisterInputTag, {
        displayName: 'Grace Hopper',
        identifiers,
        password: 'plaintext-pass',
      }),
    ),
  );

describe('registerUserUCFactory', () => {
  it('hashes the password, creates the account, and returns the auth subject', async () => {
    let received: CreateAccountInput | undefined;
    const exit = await runRegister(
      stubAccounts((input) => {
        received = input;
      }),
      [
        { type: IdentifierType.Email, value: 'grace@example.com' },
        { type: IdentifierType.Username, value: 'grace' },
      ],
    );

    // The store only ever receives a hash, never the plaintext.
    expect(received?.passwordHash).toBe('hashed:plaintext-pass');
    expect(received?.identifiers).toHaveLength(2);

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        userId: 'user-9',
        subject: 'user-9',
        roles: [],
        attributes: {
          displayName: 'Grace Hopper',
          status: UserStatus.Active,
        },
      });
    }
  });

  it('rejects a registration with no identifiers', async () => {
    const exit = await runRegister(stubAccounts(), []);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
      expect(exit.cause.error._tag).toBe('AuthnError');
    }
  });

  it('propagates a store conflict', async () => {
    const conflicting = AccountRepositoryTag.of({
      findByIdentifier: () => Effect.succeed(null),
      readPasswordHash: () => Effect.succeed(null),
      createAccount: () =>
        Effect.fail(new EntifixLogicError('identifier already taken')),
    });

    const exit = await runRegister(conflicting, [
      { type: IdentifierType.Email, value: 'taken@example.com' },
    ]);

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
