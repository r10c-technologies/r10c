import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity, EntityCollectionLink } from '@r10c/entifix-ts-core';

import { EntityIdentifier } from '../entity-identifier';

/**
 * Lifecycle state of a canonical user. Authorization treats a non-`active`
 * user as unable to obtain a session regardless of valid credentials.
 */
export const UserStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Disabled: 'disabled',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * The canonical user record — the single system-of-record id that every
 * microservice keys its data against. It is deliberately independent of any
 * identity provider: an IdP subject is stored as one {@link EntityIdentifier}
 * among many, so the IdP can be swapped without rewriting foreign keys.
 *
 * `identifiers` is an {@link EntityCollectionLink} (read-only accessor, no
 * setter) so the relation can arrive embedded or as foreign keys and be
 * resolved lazily, following the same link convention as the product catalog.
 */
@entity({ domain: 'authn', key: 'user-identity' })
export class UserIdentity implements Entity {
  // #region properties
  #id?: EntityId;
  #displayName?: string;
  #status: UserStatus = UserStatus.Active;
  #identifiers: EntityCollectionLink<EntityIdentifier>;
  // #endregion

  // #region constructors
  constructor() {
    this.#identifiers = new EntityCollectionLink(EntityIdentifier);
  }
  // #endregion

  // #region accessors
  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get displayName(): string | undefined {
    return this.#displayName;
  }
  set displayName(value: string | undefined) {
    this.#displayName = value;
  }

  @accessor()
  get status(): UserStatus {
    return this.#status;
  }
  set status(value: UserStatus) {
    this.#status = value;
  }

  @accessor()
  get identifiers(): EntityCollectionLink<EntityIdentifier> {
    return this.#identifiers;
  }
  // #endregion
}
