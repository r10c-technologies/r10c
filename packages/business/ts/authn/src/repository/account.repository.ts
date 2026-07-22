import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

import type { IdentifierType } from '../entities/entity-identifier';
import type { UserIdentity } from '../entities/user-identity';

/** One identifier to attach to a new account (email / username / phone …). */
export interface NewIdentifierInput {
  readonly type: IdentifierType;
  readonly value: string;
  /** Local identifiers created with a verified email flow can start verified. */
  readonly verified?: boolean;
}

/** Everything needed to provision an account in one shot. */
export interface CreateAccountInput {
  readonly displayName?: string;
  readonly identifiers: readonly NewIdentifierInput[];
  /** The already-hashed password — hashing is the use-case's job, not the store's. */
  readonly passwordHash: string;
}

/**
 * The account persistence seam for the credential flow. Account creation spans
 * three collections (user, identifiers, credential) and enforces identifier
 * uniqueness, so it is a single store-owned operation rather than something the
 * use-case stitches together. The adapter (Mongo in the service, a fake in
 * tests) owns that; the use-cases stay framework-free over {@link
 * AccountRepositoryTag}.
 */
export interface AccountRepository {
  /** Resolve any identifier value (any type) to its canonical user, or null. */
  findByIdentifier(value: string): Effect<UserIdentity | null, EntifixError>;
  /** Read a user's stored password hash, or null when none is set. */
  readPasswordHash(userId: EntityId): Effect<string | null, EntifixError>;
  /**
   * Provision user + identifiers + credential atomically, returning the created
   * user. Fails when any identifier value is already taken.
   */
  createAccount(input: CreateAccountInput): Effect<UserIdentity, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link AccountRepository}. */
export class AccountRepositoryTag extends Context.Tag('AccountRepositoryTag')<
  AccountRepositoryTag,
  AccountRepository
>() {}
