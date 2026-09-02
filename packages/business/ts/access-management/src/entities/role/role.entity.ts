import type { Permission } from '@r10c/business-ts-authz';
import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * A role an organization defines for its own staff — "sales", "inventory",
 * whatever its business needs — together with the permissions it grants.
 *
 * This is the axis the platform's own `Role` (`business-ts-authz`) cannot
 * express. That one is a closed, ordered set in code, because an ordered tier is
 * what makes the escalation rule sayable without a policy language. A role
 * invented by a customer last week cannot live in a closed set, so it lives
 * here as **data**.
 *
 * Two ceilings bound what a role may grant: the actor's own tier
 * (`canAssignRole`), and the organization's {@link Entitlement} — a role cannot
 * grant a permission in a domain the organization is not provisioned for.
 *
 * The access token still carries only role **names**; grants are resolved at the
 * consumer through `PolicyDecisionTag`, so a policy edit takes effect without
 * waiting out every issued token.
 *
 * Control plane.
 */
@entity({
  domain: 'access-management',
  key: 'role',
  labelKey: 'entity:role.label',
  pluralKey: 'entity:role.plural',
})
export class Role implements Entity {
  // #region properties
  #id?: EntityId;
  #organizationId: string;
  #name: string;
  #permissions: readonly Permission[] = [];
  // #endregion

  // #region constructors
  constructor(organizationId = '', name = '') {
    this.#organizationId = organizationId;
    this.#name = name;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:role.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:role.fields.organizationId',
    required: true,
    filterable: true,
  })
  get organizationId(): string {
    return this.#organizationId;
  }
  set organizationId(value: string) {
    this.#organizationId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:role.fields.name',
    required: true,
    sortable: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  /** A `scalarCollection`, never queryable — see `Membership.roleIds`. */
  @accessor({
    type: 'scalarCollection',
    labelKey: 'entity:role.fields.permissions',
  })
  get permissions(): readonly Permission[] {
    return this.#permissions;
  }
  set permissions(value: readonly Permission[]) {
    this.#permissions = value;
  }
  // #endregion
}
