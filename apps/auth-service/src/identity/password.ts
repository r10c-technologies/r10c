import type { PasswordHasher } from '@r10c/business-ts-authn';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import bcrypt from 'bcryptjs';
import { Effect } from 'effect';

/** Work factor for bcrypt — 10 is the common interactive-login default. */
const BCRYPT_ROUNDS = 10;

/**
 * bcrypt-backed {@link PasswordHasher}. Pure-JS `bcryptjs` (no native build) so
 * it bundles into the service without a webpack `externalDependencies` entry.
 * The register/login use-cases stay crypto-free behind {@link PasswordHasherTag}.
 */
export const makeBcryptPasswordHasher = (
  rounds: number = BCRYPT_ROUNDS,
): PasswordHasher => ({
  hash: (plain) =>
    Effect.tryPromise({
      try: () => bcrypt.hash(plain, rounds),
      catch: (error) => new EntifixConnError('Password hashing failed', error),
    }),
  verify: (plain, hash) =>
    Effect.tryPromise({
      try: () => bcrypt.compare(plain, hash),
      catch: (error) =>
        new EntifixConnError('Password verification failed', error),
    }),
});
