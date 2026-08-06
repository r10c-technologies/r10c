import type { Role } from '@r10c/business-ts-authz';
import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

import type { IdentifierType } from '../entities/entity-identifier';
import type { UserIdentity, UserStatus } from '../entities/user-identity';

/** One identifier to attach to a new account (email / username / phone …). */
export interface NewIdentifierInput {
  readonly type: IdentifierType;
  readonly value: string;
  /** Local identifiers created with a verified email flow can start verified. */
  readonly verified?: boolean;
  /**
   * Issuer, for a federated identifier (`zitadel`, `google`); absent for a
   * local one.
   *
   * Carried here as well as on {@link AccountRepository.linkExternalSubject}
   * because an account can be provisioned with its subject in the same atomic
   * write — and an `external-subject` row with no provider is a row whose origin
   * nobody can tell later.
   */
  readonly provider?: string;
}

/** Everything needed to provision an account in one shot. */
export interface CreateAccountInput {
  readonly displayName?: string;
  readonly identifiers: readonly NewIdentifierInput[];
  /** Authorization aspect, already vetted against the caller's tier. */
  readonly role: Role;
}

/** The aspects an administrator may change on an existing account. */
export interface UpdateUserAspects {
  readonly role?: Role;
  readonly status?: UserStatus;
}

/**
 * The identity attributes Zitadel owns and this store only mirrors.
 *
 * Refreshed from the verified `id_token` on every sign-in, which is what keeps
 * the local copy a projection rather than a second source of truth: it can lag
 * a change made at the provider, but it can never diverge from it, because
 * nothing here is ever the thing that was edited.
 */
export interface IdentityProjection {
  readonly displayName?: string;
  /**
   * A **verified** address, or absent.
   *
   * The caller is responsible for that gate, and it is not a formality: writing
   * an unverified address onto an identifier row would let anyone claim a
   * value they do not control and collide with the account that does — which is
   * how a victim's security mail ends up addressed to someone else.
   */
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly username?: string;
}

/**
 * The account persistence seam. Account creation spans two collections (user
 * and identifiers) and enforces identifier uniqueness, so it is a single
 * store-owned operation rather than something the use-case stitches together.
 * The adapter (Mongo in the service, a fake in tests) owns that; the use-cases
 * stay framework-free over {@link AccountRepositoryTag}.
 *
 * There is deliberately **no credential surface here** — no password hash to
 * read, write or compare. Credentials live in Zitadel
 * ([ADR 0016](../../../../../docs/adr/0016-zitadel-authenticates-r10c-authorizes.md)),
 * and r10c holding none is the property that makes that true rather than
 * aspirational.
 */
export interface AccountRepository {
  /** Resolve any identifier value (any type) to its canonical user, or null. */
  findByIdentifier(value: string): Effect<UserIdentity | null, EntifixError>;
  /** Read a user by canonical id, or null. */
  findById(userId: EntityId): Effect<UserIdentity | null, EntifixError>;
  /**
   * Apply an aspect change to an existing account, returning the updated user.
   * Narrow on purpose: role and status are the only members an administrator
   * edits, and routing them through the store keeps identifiers and credentials
   * out of reach of a generic write.
   */
  updateUserAspects(
    userId: EntityId,
    changes: UpdateUserAspects,
  ): Effect<UserIdentity, EntifixError>;
  /**
   * The address account notifications go to — the user's email identifier, or
   * null when they have none.
   *
   * Explicitly NOT `AuthSubject.subject`: that is the canonical user id (or an
   * IdP `sub`), so using it as a recipient would address security mail to a
   * UUID. The contact address is a different thing from the identity, and this
   * is the only place that mapping lives.
   */
  findContactAddress(userId: EntityId): Effect<string | null, EntifixError>;
  /**
   * Provision user + identifiers atomically, returning the created user. Fails
   * when any identifier value is already taken.
   */
  createAccount(input: CreateAccountInput): Effect<UserIdentity, EntifixError>;
  /**
   * Attach the provider's `sub` to an existing account, so the next sign-in
   * resolves straight to it.
   *
   * Separate from {@link AccountRepository.createAccount} because provisioning
   * writes to two systems and only one of them can go first. The local record
   * is written first (it owns the role and the party), the Zitadel human
   * second; this is the third step that joins them. An account that never got
   * here simply cannot sign in and is repaired by running provisioning again —
   * one visible half-state, and no compensation that can itself fail.
   */
  linkExternalSubject(
    userId: EntityId,
    subject: string,
    provider: string,
  ): Effect<void, EntifixError>;
  /**
   * Overwrite the projected identity attributes from the provider's own record.
   *
   * Called by the OIDC callback on every sign-in. It is the only writer of these
   * members — the reason they can stay ordinary writable accessors without
   * becoming a second place a user's email is edited.
   */
  projectIdentity(
    userId: EntityId,
    projection: IdentityProjection,
  ): Effect<void, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link AccountRepository}. */
export class AccountRepositoryTag extends Context.Tag('AccountRepositoryTag')<
  AccountRepositoryTag,
  AccountRepository
>() {}
