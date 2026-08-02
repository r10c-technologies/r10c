import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * A party's participation in an organization, and the roles it holds there.
 *
 * This is the record that makes tenancy resolvable: signing in answers "who",
 * a membership answers "on behalf of which organization", and the session
 * carries the chosen one as `activeOrganizationId`. A person may hold several
 * memberships, which is why the active organization is a property of the
 * **session** rather than of the user — modelling it on the user would make
 * someone serving two vendors keep two accounts.
 *
 * `partyId` and `organizationId` are plain ids rather than entity links:
 * `party-management` is a sibling `business:domain` package, and the boundary
 * rule forbids a sideways import between domains. `roleIds` names roles defined
 * in this same package, so no seam is crossed there either.
 *
 * Control plane.
 */
@entity({
  domain: 'access-management',
  key: 'membership',
  labelKey: 'entity:membership.label',
  pluralKey: 'entity:membership.plural',
})
export class Membership implements Entity {
  // #region properties
  #id?: EntityId;
  #partyId: string;
  #organizationId: string;
  #roleIds: readonly string[] = [];
  #isDefault = false;
  // #endregion

  // #region constructors
  constructor(partyId = '', organizationId = '') {
    this.#partyId = partyId;
    this.#organizationId = organizationId;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:membership.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:membership.fields.partyId',
    required: true,
    filterable: true,
  })
  get partyId(): string {
    return this.#partyId;
  }
  set partyId(value: string) {
    this.#partyId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:membership.fields.organizationId',
    required: true,
    filterable: true,
  })
  get organizationId(): string {
    return this.#organizationId;
  }
  set organizationId(value: string) {
    this.#organizationId = value;
  }

  /**
   * `MetaAccessorTypes` is a presentation taxonomy of scalars plus the two link
   * kinds; a plain array of ids is none of them. It is declared `string` — the
   * element type — with sorting and filtering switched **off**, because member
   * metadata is also the server-side query allowlist and an array compared as a
   * string would silently match nothing.
   *
   * Note `hidden` would be the wrong tool here: it drops a member from
   * serialization *and* deserialization, exactly as `readonly` does, so the
   * roles would never reach storage.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:membership.fields.roleIds',
    sortable: false,
    filterable: false,
  })
  get roleIds(): readonly string[] {
    return this.#roleIds;
  }
  set roleIds(value: readonly string[]) {
    this.#roleIds = value;
  }

  /**
   * Which membership a sign-in resolves to when the party holds several. Exactly
   * one per party should carry it; a party with none is asked to choose.
   */
  @accessor({
    type: 'boolean',
    labelKey: 'entity:membership.fields.isDefault',
    filterable: true,
  })
  get isDefault(): boolean {
    return this.#isDefault;
  }
  set isDefault(value: boolean) {
    this.#isDefault = value;
  }
  // #endregion
}
