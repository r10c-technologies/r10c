import { DEFAULT_ROLE, type Role } from '@r10c/business-ts-authz';
import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { IdentifierType } from '../../entities/entity-identifier/index.js';
import {
  UserIdentity,
  UserStatus,
} from '../../entities/user-identity/index.js';
import {
  AccountRepositoryTag,
  type CreateAccountInput,
  PasswordHasherTag,
} from '../../repository/index.js';
import { RegisterInputTag, registerUserUCFactory } from './register-user.uc.js';

const createdUser = (role: Role = DEFAULT_ROLE): UserIdentity => {
  const user = new UserIdentity();
  user.id = 'user-9';
  user.displayName = 'Grace Hopper';
  user.status = UserStatus.Active;
  user.role = role;
  return user;
};

const stubAccounts = (
  onCreate: (input: CreateAccountInput) => void = () => undefined,
) =>
  AccountRepositoryTag.of({
    findByIdentifier: () => Effect.succeed(null),
    findById: () => Effect.succeed(null),
    findContactAddress: () => Effect.succeed(null),
    readPasswordHash: () => Effect.succeed(null),
    writePasswordHash: () => Effect.void,
    createAccount: input => {
      onCreate(input);
      return Effect.succeed(createdUser(input.role));
    },
    updateUserAspects: () =>
      Effect.fail(new EntifixLogicError('not used in register')),
  });

const hasher = PasswordHasherTag.of({
  hash: plain => Effect.succeed(`hashed:${plain}`),
  verify: () => Effect.succeed(false),
});

const runRegister = (
  accounts: ReturnType<typeof stubAccounts>,
  identifiers: { type: IdentifierType; value: string }[],
  grant: { role?: Role; actorRoles?: readonly string[] } = {},
) =>
  Effect.runPromiseExit(
    registerUserUCFactory().pipe(
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(PasswordHasherTag, hasher),
      Effect.provideService(RegisterInputTag, {
        displayName: 'Grace Hopper',
        identifiers,
        password: 'plaintext-pass',
        ...grant,
      }),
    ),
  );

const anEmail = [{ type: IdentifierType.Email, value: 'grace@example.com' }];

describe('registerUserUCFactory', () => {
  it('hashes the password, creates the account, and returns the auth subject', async () => {
    let received: CreateAccountInput | undefined;
    const exit = await runRegister(
      stubAccounts(input => {
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
        roles: [DEFAULT_ROLE],
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
      findById: () => Effect.succeed(null),
      findContactAddress: () => Effect.succeed(null),
      readPasswordHash: () => Effect.succeed(null),
      writePasswordHash: () => Effect.void,
      createAccount: () =>
        Effect.fail(new EntifixLogicError('identifier already taken')),
      updateUserAspects: () =>
        Effect.fail(new EntifixLogicError('not used in register')),
    });

    const exit = await runRegister(conflicting, [
      { type: IdentifierType.Email, value: 'taken@example.com' },
    ]);

    expect(Exit.isFailure(exit)).toBe(true);
  });

  describe('the role a new account is provisioned with', () => {
    it('defaults to the lowest tier when none is requested', async () => {
      let received: CreateAccountInput | undefined;
      await runRegister(
        stubAccounts(input => {
          received = input;
        }),
        anEmail,
      );

      expect(received?.role).toBe(DEFAULT_ROLE);
    });

    it('lets an actor grant a role at its own tier', async () => {
      let received: CreateAccountInput | undefined;
      const exit = await runRegister(
        stubAccounts(input => {
          received = input;
        }),
        anEmail,
        { role: 'admin', actorRoles: ['admin'] },
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(received?.role).toBe('admin');
    });

    it('refuses an actor granting above its own tier', async () => {
      const exit = await runRegister(stubAccounts(), anEmail, {
        role: 'super-admin',
        actorRoles: ['admin'],
      });

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
        // Not an AuthnError: the request is fine, the caller is not allowed.
        expect(exit.cause.error._tag).toBe('ForbiddenError');
      }
    });

    it('refuses a public signup that asks for a role, however low', async () => {
      // No `actorRoles` at all: an anonymous caller crafting `role` into the
      // body must not be able to pick its own tier.
      const exit = await runRegister(stubAccounts(), anEmail, {
        role: DEFAULT_ROLE,
      });

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
