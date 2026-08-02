import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * Lifecycle state of an organization. A non-`active` organization keeps its
 * storage — suspension is a billing or compliance state, never a deletion.
 */
export const OrganizationStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Archived: 'archived',
} as const;

export type OrganizationStatus =
  (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

/**
 * A `Party` that is a company — and **the tenant**: the unit that per-tenant
 * storage is provisioned for.
 *
 * This entity is the one place tenancy is explicit. Every other business entity
 * is organization-agnostic (no `organizationId` member, no tenant filter);
 * isolation comes from which database handle a request resolves to, which is
 * why no query can leak by omission. The organization record is what makes that
 * handle derivable, so it necessarily lives in the **control plane**.
 *
 * `slug` is stable and human-readable — it appears in operator tooling and in
 * support conversations — but it is deliberately *not* what names the tenant
 * database. That is derived from the id, so renaming an organization can never
 * strand its data.
 */
@entity({
  domain: 'party-management',
  key: 'organization',
  labelKey: 'entity:organization.label',
  pluralKey: 'entity:organization.plural',
})
export class Organization implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #slug: string;
  #status: OrganizationStatus = OrganizationStatus.Active;
  // #endregion

  // #region constructors
  constructor(name = '', slug = '') {
    this.#name = name;
    this.#slug = slug;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:organization.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.name',
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

  @accessor({
    type: 'string',
    labelKey: 'entity:organization.fields.slug',
    required: true,
    sortable: true,
    filterable: true,
  })
  get slug(): string {
    return this.#slug;
  }
  set slug(value: string) {
    this.#slug = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:organization.fields.status',
    enumValues: Object.values(OrganizationStatus),
    enumLabelKey: 'entity:organization.values.status',
    sortable: true,
    filterable: true,
  })
  get status(): OrganizationStatus {
    return this.#status;
  }
  set status(value: OrganizationStatus) {
    this.#status = value;
  }
  // #endregion
}
