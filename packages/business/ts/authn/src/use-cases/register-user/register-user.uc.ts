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

    const passwordHash = yield* hasher.hash(input.password);
    const user = yield* accounts.createAccount({
      displayName: input.displayName,
      identifiers: input.identifiers,
      passwordHash,
    });

    return authSubjectFromUser(user);
  });
}
