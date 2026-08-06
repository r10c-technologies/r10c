import { DEFAULT_ROLE, type Role, Roles } from '@r10c/business-ts-authz';
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
 *
 * `role` is the authorization aspect. It lives here rather than in a separate
 * role entity so generic UI renders it from the metadata alone and the
 * server-side query allowlist covers it, and it is the value
 * `authSubjectFromUser` projects into every session and access token.
 *
 * **One writer per member.** `role` is r10c's alone — Zitadel never sees it.
 * `displayName` and `status` are the opposite: Zitadel owns them, and what is
 * stored here is a **projection** refreshed from the verified `id_token` on
 * every sign-in. They stay writable rather than `@accessor({ readonly })`
 * because that flag would drop them from deserialization too and the UI would
 * never see them; what keeps them honest is that only the OIDC callback and the
 * provisioning path write them, exactly as a route owns an audit stamp. An
 * administrative edit goes to Zitadel's management API and comes back through
 * the same projection, so the two records cannot drift apart in the one
 * direction that would matter.
 */
@entity({
  domain: 'authn',
  key: 'user-identity',
  labelKey: 'entity:user-identity.label',
  pluralKey: 'entity:user-identity.plural',
})
export class UserIdentity implements Entity {
  // #region properties
  #id?: EntityId;
  #displayName?: string;
  #status: UserStatus = UserStatus.Active;
  #role: Role = DEFAULT_ROLE;
  #identifiers: EntityCollectionLink<EntityIdentifier>;
  // #endregion

  // #region constructors
  constructor() {
    this.#identifiers = new EntityCollectionLink(EntityIdentifier);
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:user-identity.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ labelKey: 'entity:user-identity.fields.displayName' })
  get displayName(): string | undefined {
    return this.#displayName;
  }
  set displayName(value: string | undefined) {
    this.#displayName = value;
  }

  // Declared as the enum it already is in the domain: without `enumValues` the
  // descriptor inferred `string`, so the raw `active`/`suspended` token reached
  // the user untranslated and the filter offered substring matching on it.
  @accessor({
    type: 'enum',
    labelKey: 'entity:user-identity.fields.status',
    enumValues: Object.values(UserStatus),
    enumLabelKey: 'entity:user-identity.values.status',
  })
  get status(): UserStatus {
    return this.#status;
  }
  set status(value: UserStatus) {
    this.#status = value;
  }

  @accessor({
    type: 'enum',
    label: 'Role',
    labelKey: 'entity:user-identity.fields.role',
    enumValues: Roles,
    enumLabelKey: 'entity:user-identity.values.role',
    sortable: true,
    filterable: true,
  })
  get role(): Role {
    return this.#role;
  }
  set role(value: Role) {
    this.#role = value;
  }

  @accessor({ labelKey: 'entity:user-identity.fields.identifiers' })
  get identifiers(): EntityCollectionLink<EntityIdentifier> {
    return this.#identifiers;
  }
  // #endregion
}
