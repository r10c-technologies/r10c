import type { EntifixError } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * One-way password hashing. Kept behind a port so the algorithm (bcrypt in the
 * service, a trivial fake in tests) is a composition-root choice and the
 * register/login use-cases never import a crypto library.
 */
export interface PasswordHasher {
  /** Hash a plaintext password for storage. */
  hash(plain: string): Effect<string, EntifixError>;
  /** Constant-time compare a plaintext password against a stored hash. */
  verify(plain: string, hash: string): Effect<boolean, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link PasswordHasher}. */
export class PasswordHasherTag extends Context.Tag('PasswordHasherTag')<
  PasswordHasherTag,
  PasswordHasher
>() {}
