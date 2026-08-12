import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import { type PartyRoleName, PartyRoles } from '../../values/party-role';

/**
 * A role a `Party` plays on this platform — `customer`, `vendor`, `operator` —
 * as a **record**, not as a column on the party.
 *
 * SID makes `Customer` a subclass of `PartyRole` precisely so a party is never
 * hard-wired as one thing: a party plays many roles over time and several at
 * once. BUSINESS-ARCHITECTURE names the case this exists for — an organization
 * that is a marketplace vendor *and* a CRM customer — and the single
 * `Individual.partyRole` column it replaces could not express it
 * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * This is the source the `partyRole` access-token claim is **derived** from. The
 * claim is unchanged in every respect that matters: a closed set, a plane
 * selector, resolved once at sign-in, re-signed unchanged on refresh, routing
 * context and never a grant
 * ([ADR 0015](../../../../../../docs/adr/0015-asymmetric-access-tokens-and-the-party-role-claim.md)).
 * Only its source moved, from a column to a queryable record.
 *
 * When a party holds several, `SessionScopeResolver` picks by **reach**:
 * `operator` > `vendor` > `customer`. Recorded cost — an operator who is also a
 * buyer always gets an operator session, so there is no way to act as a buyer
 * while being staff.
 *
 * The role name stays the closed set in `values/party-role.ts`, because it is
 * also the plane selector and a storage boundary must not be decided by a
 * free-form string.
 *
 * Control plane, `auth` store.
 */
@entity({
  domain: 'party-management',
  key: 'party-role',
  labelKey: 'entity:party-role.label',
  pluralKey: 'entity:party-role.plural',
})
export class PartyRole implements Entity {
  // #region properties
  #id?: EntityId;
  #partyId: string;
  #role: PartyRoleName;
  // #endregion

  // #region constructors
  constructor(partyId = '', role: PartyRoleName = 'customer') {
    this.#partyId = partyId;
    this.#role = role;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:party-role.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The `Party` playing the role. Filterable because resolving a session is
   * exactly "every role this party holds" — member metadata is also the
   * server-side allowlist, so a lookup that could not filter would read
   * everything.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:party-role.fields.partyId',
    required: true,
    filterable: true,
  })
  get partyId(): string {
    return this.#partyId;
  }
  set partyId(value: string) {
    this.#partyId = value;
  }

  /** Filterable: "which parties are vendors?" is an operator screen. */
  @accessor({
    type: 'enum',
    labelKey: 'entity:party-role.fields.role',
    enumValues: PartyRoles,
    enumLabelKey: 'entity:party-role.values.role',
    required: true,
    filterable: true,
  })
  get role(): PartyRoleName {
    return this.#role;
  }
  set role(value: PartyRoleName) {
    this.#role = value;
  }
  // #endregion
}
