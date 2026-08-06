import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import { type PartyRoleName, PartyRoles } from '../../values/party-role';

/**
 * A `Party` that is a person.
 *
 * Deliberately thin, and deliberately **not** the account. `UserIdentity`
 * (`business-ts-authn`) owns credentials, status and sessions; an `Individual`
 * is the person those credentials belong to. Keeping them apart is what lets a
 * person exist as a party — a contact on an organization, a payee — before or
 * without ever signing in, and it keeps identity-provider churn out of the
 * business model.
 *
 * `userId` links back to the canonical account when there is one. It is a plain
 * id rather than an entity link because `authn` is a sibling domain, and a
 * `business:domain` package may never import another.
 *
 * Control plane.
 */
@entity({
  domain: 'party-management',
  key: 'individual',
  labelKey: 'entity:individual.label',
  pluralKey: 'entity:individual.plural',
})
export class Individual implements Entity {
  // #region properties
  #id?: EntityId;
  #fullName: string;
  #userId?: string;
  // A person the platform knows nothing else about is someone who shops here:
  // the default has to be the population with the least reach.
  #partyRole: PartyRoleName = 'customer';
  // #endregion

  // #region constructors
  constructor(fullName = '') {
    this.#fullName = fullName;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:individual.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:individual.fields.fullName',
    required: true,
    sortable: true,
    filterable: true,
  })
  get fullName(): string {
    return this.#fullName;
  }
  set fullName(value: string) {
    this.#fullName = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:individual.fields.userId',
    filterable: true,
  })
  get userId(): string | undefined {
    return this.#userId;
  }
  set userId(value: string | undefined) {
    this.#userId = value;
  }

  /**
   * Which role this person plays on the platform, and therefore which data
   * plane their sessions read.
   *
   * It lives on the party rather than on `UserIdentity` because it is a fact
   * about the person, not about their credentials — and because `UserIdentity.role`
   * is the *authorization* aspect, a separate axis. Collapsing the two is
   * exactly what [ADR 0007] says a single `roles` array cannot express: a
   * closed set of grants cannot also say which side of the tenancy boundary
   * someone stands on.
   *
   * `filterable` so an operator screen can list one population at a time; the
   * value reaches a session through the sign-in scope resolver, never through
   * a request.
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:individual.fields.partyRole',
    enumValues: PartyRoles,
    enumLabelKey: 'entity:individual.values.partyRole',
    sortable: true,
    filterable: true,
  })
  get partyRole(): PartyRoleName {
    return this.#partyRole;
  }
  set partyRole(value: PartyRoleName) {
    this.#partyRole = value;
  }
  // #endregion
}
