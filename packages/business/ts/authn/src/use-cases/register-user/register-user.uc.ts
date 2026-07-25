import {
  canAssignRole,
  DEFAULT_ROLE,
  type Role,
} from '@r10c/business-ts-authz';
import { Context, Effect } from 'effect';

import { AuthnError } from '../../errors';
import {
  AccountRepositoryTag,
  type NewIdentifierInput,
  PasswordHasherTag,
} from '../../repository';
import { authSubjectFromUser } from '../../values';

/** The data a self-registration submits. */
export interface RegisterUserInput {
  readonly displayName?: string;
  /** One or more identifiers the account can log in with (email, username …). */
  readonly identifiers: readonly NewIdentifierInput[];
  readonly password: string;
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
 * Provision a new account and return the {@link AuthSubject} to log the user
 * straight in. The password is hashed here (so the store only ever sees a hash)
 * and the account is created atomically with all its identifiers; identifier
 * uniqueness is enforced by the store and surfaces as an {@link AuthnError}.
 *
 * This is also the **only** path that creates a user, administrative creates
 * included — a generic entity write would bypass hashing, identifier uniqueness
 * and the role rule below. A caller may grant a role only at or below its own
 * tier, so a public signup (no `actorRoles`) always lands on
 * {@link DEFAULT_ROLE} however the request body is crafted.
 *
 * Framework-free: yields the account repository + hasher tags the shell binds.
 */
export function registerUserUCFactory() {
  return Effect.gen(function* () {
    const input = yield* RegisterInputTag;
    const accounts = yield* AccountRepositoryTag;
    const hasher = yield* PasswordHasherTag;

    if (input.identifiers.length === 0) {
      return yield* Effect.fail(
        new AuthnError('an account needs at least one identifier'),
      );
    }

    // An explicitly requested role always has to be earned; an absent one is a
    // public signup and silently becomes the default.
    if (
      input.role !== undefined &&
      !canAssignRole(input.actorRoles ?? [], input.role)
    ) {
      return yield* Effect.fail(
        new AuthnError('not allowed to assign that role', undefined, {
          role: input.role,
        }),
      );
    }
    const role = input.role ?? DEFAULT_ROLE;

    const passwordHash = yield* hasher.hash(input.password);
    const user = yield* accounts.createAccount({
      displayName: input.displayName,
      identifiers: input.identifiers,
      passwordHash,
      role,
    });

    return authSubjectFromUser(user);
  });
}
