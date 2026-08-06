import type { Role } from '@r10c/business-ts-authz';
import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  UserIdentity,
  UserStatus,
} from '../../entities/user-identity/index.js';
import {
  AccountRepositoryTag,
  type UpdateUserAspects,
} from '../../repository/index.js';
import {
  UpdateUserAspectsInputTag,
  updateUserAspectsUCFactory,
} from './update-user-aspects.uc.js';

const userWith = (role: Role, id = 'target-1'): UserIdentity => {
  const user = new UserIdentity();
  user.id = id;
  user.displayName = 'Target';
  user.role = role;
  return user;
};

const stubAccounts = (
  target: UserIdentity | null,
  onUpdate: (changes: UpdateUserAspects) => void = () => undefined,
) =>
  AccountRepositoryTag.of({
    findByIdentifier: () => Effect.succeed(null),
    findById: () => Effect.succeed(target),
    findContactAddress: () => Effect.succeed(null),
    linkExternalSubject: () => Effect.void,
    projectIdentity: () => Effect.void,

    createAccount: () =>
      Effect.fail(new EntifixLogicError('not used in update')),
    updateUserAspects: (_userId, changes) => {
      onUpdate(changes);
      const updated = userWith(changes.role ?? target?.role ?? 'user');
      updated.status = changes.status ?? UserStatus.Active;
      return Effect.succeed(updated);
    },
  });

const runUpdate = (
  accounts: ReturnType<typeof stubAccounts>,
  input: {
    userId?: string;
    role?: Role;
    status?: UserStatus;
    actorUserId?: string;
    actorRoles?: readonly string[];
  },
) =>
  Effect.runPromiseExit(
    updateUserAspectsUCFactory().pipe(
      Effect.provideService(AccountRepositoryTag, accounts),
      Effect.provideService(UpdateUserAspectsInputTag, {
        userId: input.userId ?? 'target-1',
        role: input.role,
        status: input.status,
        actorUserId: input.actorUserId ?? 'actor-1',
        actorRoles: input.actorRoles ?? ['admin'],
      }),
    ),
  );

const failedWith = (exit: Exit.Exit<unknown, unknown>, tag: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
    expect((exit.cause.error as { _tag: string })._tag).toBe(tag);
  }
};

/** A refusal of the request itself — malformed, or about a user that is gone. */
const failedWithAuthnError = (exit: Exit.Exit<unknown, unknown>) =>
  failedWith(exit, 'AuthnError');

/** A refusal of the *caller* — the tier rules. Distinct, and a 403 at the edge. */
const failedWithForbidden = (exit: Exit.Exit<unknown, unknown>) =>
  failedWith(exit, 'ForbiddenError');

describe('updateUserAspectsUCFactory', () => {
  it('applies a role change within the actor’s tier', async () => {
    let changes: UpdateUserAspects | undefined;
    const exit = await runUpdate(
      stubAccounts(userWith('user'), received => {
        changes = received;
      }),
      { role: 'admin', actorRoles: ['admin'] },
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(changes).toEqual({ role: 'admin', status: undefined });
  });

  it('applies a status change on its own', async () => {
    let changes: UpdateUserAspects | undefined;
    const exit = await runUpdate(
      stubAccounts(userWith('user'), received => {
        changes = received;
      }),
      { status: UserStatus.Suspended },
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(changes).toEqual({ role: undefined, status: UserStatus.Suspended });
  });

  it('rejects a request that changes nothing', async () => {
    failedWithAuthnError(await runUpdate(stubAccounts(userWith('user')), {}));
  });

  it('rejects an unknown user', async () => {
    failedWithAuthnError(await runUpdate(stubAccounts(null), { role: 'user' }));
  });

  // Without this an admin could demote a super-admin and inherit the system.
  it('rejects modifying a user who outranks the actor', async () => {
    failedWithForbidden(
      await runUpdate(stubAccounts(userWith('super-admin')), {
        role: 'user',
        actorRoles: ['admin'],
      }),
    );
  });

  it('rejects promoting above the actor’s own tier', async () => {
    failedWithForbidden(
      await runUpdate(stubAccounts(userWith('user')), {
        role: 'super-admin',
        actorRoles: ['admin'],
      }),
    );
  });

  describe('acting on yourself', () => {
    const selfUpdate = (
      input: { role?: Role; status?: UserStatus },
      currentRole: Role = 'admin',
    ) =>
      runUpdate(stubAccounts(userWith(currentRole, 'actor-1')), {
        ...input,
        userId: 'actor-1',
        actorUserId: 'actor-1',
        actorRoles: [currentRole],
      });

    it('refuses self-demotion', async () => {
      failedWithForbidden(await selfUpdate({ role: 'user' }));
    });

    it('refuses self-deactivation', async () => {
      failedWithForbidden(await selfUpdate({ status: UserStatus.Disabled }));
    });

    it('allows a no-op that reasserts the same role and active status', async () => {
      const exit = await selfUpdate({
        role: 'admin',
        status: UserStatus.Active,
      });

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });
});
