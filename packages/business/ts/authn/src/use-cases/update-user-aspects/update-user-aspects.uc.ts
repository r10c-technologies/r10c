import {
  canAssignRole,
  permissionForUseCase,
  type Role,
} from '@r10c/business-ts-authz';
import { type EntityId, useCase } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import { UserIdentity, UserStatus } from '../../entities/user-identity';
import { AuthnError, ForbiddenError } from '../../errors';
import { AccountRepositoryTag } from '../../repository';

/** An administrative change to another account's authorization aspects. */
export interface UpdateUserAspectsInput {
  readonly userId: EntityId;
  readonly role?: Role;
  readonly status?: UserStatus;
  /** The verified caller, so the use-case can refuse self-inflicted lockouts. */
  readonly actorUserId: EntityId;
  readonly actorRoles: readonly string[];
}

/** Input tag: the aspect change, provided per call. */
export class UpdateUserAspectsInputTag extends Context.Tag(
  'UpdateUserAspectsInputTag',
)<UpdateUserAspectsInputTag, UpdateUserAspectsInput>() {}

/**
 * Change an existing account's role and/or status under the same tier rule that
 * governs creation, plus two guards creation does not need:
 *
 * - the actor must outrank (or match) the target's **current** role, otherwise
 *   an admin could demote a super-admin and inherit the system;
 * - an actor may not demote or deactivate **itself**, which would otherwise be a
 *   one-click way to lock the last super-admin out.
 *
 * Framework-free: the caller is responsible for having verified the actor, and
 * for revoking the target's sessions once this succeeds. This use case still
 * does not touch the session store, and the route still orders the two — what
 * changed is that revocation is now {@link RevokeUserSessionsUC}, a verb with a
 * permission of its own, rather than a nameless side effect of `write`.
 */
@useCase({
  entity: UserIdentity,
  key: 'update-aspects',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:user-identity.useCases.updateAspects',
})
export class UpdateUserAspectsUC {
  static run() {
    return Effect.gen(function* () {
      const input = yield* UpdateUserAspectsInputTag;
      const accounts = yield* AccountRepositoryTag;

      if (input.role === undefined && input.status === undefined) {
        return yield* Effect.fail(
          new AuthnError('nothing to update', 'nothingToUpdate'),
        );
      }

      const target = yield* accounts.findById(input.userId);
      if (target === null) {
        return yield* Effect.fail(
          new AuthnError('user not found', 'userNotFound', undefined, {
            userId: input.userId,
          }),
        );
      }

      // Authority over the account as it stands today.
      if (!canAssignRole(input.actorRoles, target.role)) {
        return yield* Effect.fail(
          new ForbiddenError(
            'not allowed to modify that user',
            'userNotAllowed',
            undefined,
            {
              role: target.role,
            },
          ),
        );
      }

      // Authority over the account as it would become.
      if (
        input.role !== undefined &&
        !canAssignRole(input.actorRoles, input.role)
      ) {
        return yield* Effect.fail(
          new ForbiddenError(
            'not allowed to assign that role',
            'roleNotAllowed',
            undefined,
            {
              role: input.role,
            },
          ),
        );
      }

      if (input.actorUserId === input.userId) {
        const demoting = input.role !== undefined && input.role !== target.role;
        const deactivating =
          input.status !== undefined && input.status !== UserStatus.Active;
        if (demoting || deactivating) {
          return yield* Effect.fail(
            new ForbiddenError(
              'cannot change your own role or status',
              'selfRoleChange',
            ),
          );
        }
      }

      return yield* accounts.updateUserAspects(input.userId, {
        role: input.role,
        status: input.status,
      });
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — this
 * is the only place in the repo the string `update-aspects` is written outside
 * the grant table, and the source scan checks those two agree.
 */
export const UPDATE_ASPECTS = permissionForUseCase(UpdateUserAspectsUC);
