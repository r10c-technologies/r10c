import {
  canAssignRole,
  DEFAULT_ROLE,
  type Role,
} from '@r10c/business-ts-authz';
import { Context, Effect } from 'effect';

import { AuthnError, ForbiddenError } from '../../errors';
import {
  AccountRepositoryTag,
  type NewIdentifierInput,
} from '../../repository';
import { authSubjectFromUser } from '../../values';

/** The data a self-registration submits. */
export interface RegisterUserInput {
  readonly displayName?: string;
  /**
   * One or more identifiers the account is known by (email, username, and the
   * Zitadel `sub` as an `external-subject`).
   *
   * There is no password beside them: the credential belongs to Zitadel, and
   * this use-case never sees one. What makes an account reachable at sign-in is
   * the `external-subject` identifier, which is why provisioning records it in
   * the same atomic write as the account itself.
   */
  readonly identifiers: readonly NewIdentifierInput[];
  /**
   * The role to provision the account with. Ignored unless `actorRoles` permits
   * it; absent means {@link DEFAULT_ROLE}.
   */
  readonly role?: Role;
  /**
   * Roles of the caller creating this account. **Absent means public signup** —
   * no actor, so no role above the default can be granted no matter what the
   * request body asks for. An administrative create passes the verified
   * principal's roles here.
   */
  readonly actorRoles?: readonly string[];
}

/** Input tag: the registration data, provided per call. */
export class RegisterInputTag extends Context.Tag('RegisterInputTag')<
  RegisterInputTag,
  RegisterUserInput
>() {}

/**
 * Provision a new account and return the {@link AuthSubject} to open a session
 * for. The account is created atomically with all its identifiers; identifier
 * uniqueness is enforced by the store and surfaces as an {@link AuthnError}.
 *
 * This is the **only** path that creates a user — first sign-in through the
 * hosted UI, an administrative create, and the boot seed all arrive here,
 * because a generic entity write would bypass identifier uniqueness and the
 * role rule below. A caller may grant a role only at or below its own tier, so
 * a self-registration (no `actorRoles`) always lands on {@link DEFAULT_ROLE}
 * however the request is crafted.
 *
 * Framework-free: yields the account repository tag the shell binds.
 */
export function registerUserUCFactory() {
  return Effect.gen(function* () {
    const input = yield* RegisterInputTag;
    const accounts = yield* AccountRepositoryTag;

    if (input.identifiers.length === 0) {
      return yield* Effect.fail(
        new AuthnError(
          'an account needs at least one identifier',
          'identifierRequired',
        ),
      );
    }

    // An explicitly requested role always has to be earned; an absent one is a
    // public signup and silently becomes the default.
    if (
      input.role !== undefined &&
      !canAssignRole(input.actorRoles ?? [], input.role)
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
    const role = input.role ?? DEFAULT_ROLE;

    const user = yield* accounts.createAccount({
      displayName: input.displayName,
      identifiers: input.identifiers,
      role,
    });

    return authSubjectFromUser(user);
  });
}
