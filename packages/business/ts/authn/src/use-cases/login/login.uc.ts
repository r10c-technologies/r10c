import { Context, Effect } from 'effect';

import { UserStatus } from '../../entities/user-identity';
import { UnauthenticatedError } from '../../errors';
import {
  AccountRepositoryTag,
  PasswordHasherTag,
} from '../../repository';
import { authSubjectFromUser } from '../../values';

/** The credentials a login attempt presents. */
export interface LoginInput {
  /** Any of the user's identifier values — email, username, phone. */
  readonly identifier: string;
  readonly password: string;
}

/** Input tag: the login credentials, provided per call. */
export class LoginInputTag extends Context.Tag('LoginInputTag')<
  LoginInputTag,
  LoginInput
>() {}

/**
 * Verify presented credentials and return the {@link AuthSubject} to mint a
 * session + token from. Every failure mode — unknown identifier, inactive user,
 * missing credential, wrong password — collapses to the same
 * {@link UnauthenticatedError} so the response never reveals which identifiers
 * exist. Identifier lookup is type-agnostic, so a user logs in with any of
 * their identifiers.
 *
 * Framework-free: it yields tags the shell binds (Mongo-backed account
 * repository, bcrypt hasher) and references no store or crypto library itself.
 */
export function loginUCFactory() {
  return Effect.gen(function* () {
    const { identifier, password } = yield* LoginInputTag;
    const accounts = yield* AccountRepositoryTag;
    const hasher = yield* PasswordHasherTag;

    const user = yield* accounts.findByIdentifier(identifier);
    if (user === null) {
      return yield* Effect.fail(
        new UnauthenticatedError('invalid credentials'),
      );
    }
    if (user.status !== UserStatus.Active) {
      return yield* Effect.fail(
        new UnauthenticatedError('invalid credentials'),
      );
    }

    const hash = yield* accounts.readPasswordHash(user.id);
    if (hash === null) {
      return yield* Effect.fail(
        new UnauthenticatedError('invalid credentials'),
      );
    }

    const matches = yield* hasher.verify(password, hash);
    if (!matches) {
      return yield* Effect.fail(
        new UnauthenticatedError('invalid credentials'),
      );
    }

    return authSubjectFromUser(user);
  });
}
