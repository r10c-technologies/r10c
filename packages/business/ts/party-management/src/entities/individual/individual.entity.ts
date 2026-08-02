import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

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
  // #endregion
}
