import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * The business domains an organization is provisioned for — its SaaS
 * subscription, expressed in the only vocabulary the platform already has.
 *
 * A permission is `` `<domain>:<entityKey>:<action>` ``, derived from each
 * entity's own `@entity({ domain, key })`, so the *module* an organization buys,
 * the *package* that implements it and the *permission namespace* that guards it
 * are the same word. That is why this entity needs no module registry of its
 * own: `domains` holds domain names such as `product-configuration-management`
 * or `stock-management`.
 *
 * It is also the **second assignment ceiling**. The first is the actor's own
 * tier (`canAssignRole`); this one says an organization cannot mint a
 * {@link Role} granting `stock-management:*:write` unless it is provisioned for
 * stock, however senior the person minting it.
 *
 * Control plane.
 */
@entity({
  domain: 'access-management',
  key: 'entitlement',
  labelKey: 'entity:entitlement.label',
  pluralKey: 'entity:entitlement.plural',
})
export class Entitlement implements Entity {
  // #region properties
  #id?: EntityId;
  #organizationId: string;
  #domains: readonly string[] = [];
  // #endregion

  // #region constructors
  constructor(organizationId = '', domains: readonly string[] = []) {
    this.#organizationId = organizationId;
    this.#domains = domains;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:entitlement.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:entitlement.fields.organizationId',
    required: true,
    filterable: true,
  })
  get organizationId(): string {
    return this.#organizationId;
  }
  set organizationId(value: string) {
    this.#organizationId = value;
  }

  /** A string array, unsortable and unfilterable — see `Membership.roleIds`. */
  @accessor({
    type: 'string',
    labelKey: 'entity:entitlement.fields.domains',
    sortable: false,
    filterable: false,
  })
  get domains(): readonly string[] {
    return this.#domains;
  }
  set domains(value: readonly string[]) {
    this.#domains = value;
  }
  // #endregion
}
