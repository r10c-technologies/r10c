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
 * A role is played **in a context**, which is what {@link organizationId}
 * carries. `SessionScopeResolver` resolves the session's organization from the
 * membership it opened under and then reads the role played there, so a party
 * that sells for one organization and buys from another gets the role that
 * matches the door it came in through rather than the widest one it holds.
 *
 * An organization-less row is a role with no tenant context — `operator`, which
 * holds no tenant scope at all, and a plain `customer`, who belongs to no
 * organization. Those are the only rows a party with no membership can have, and
 * among them the resolver still picks by reach; see {@link organizationId}.
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
  #organizationId?: string;
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

  /**
   * The organization the role is played in, when it is played in one.
   *
   * **Optional, and the two cases are not symmetrical.** A `vendor` is scoped to
   * one tenant's storage, so a vendor role without an organization names nothing
   * — it is the membership's organization, and the resolver reads the two
   * together. An `operator` holds **no** tenant scope at all by decision, and a
   * `customer` belongs to no organization either, so both are stored without
   * one. Absent therefore means "played on the platform", not "not filled in".
   *
   * This is what replaced precedence by reach (#76). The old rule picked the
   * widest role a party held anywhere — `operator` over `vendor` over `customer`
   * — which needed no extra input and could not express the ordinary fact that a
   * party sells for one organization and buys from another.
   *
   * ⚠️ **Precedence survives in one place, and the residual is narrower rather
   * than gone.** A party with no membership has only organization-less rows to
   * choose between, and nothing in the session says which it meant; the resolver
   * still takes the widest. So staff who are also buyers still open an operator
   * session. Closing that needs an explicit choice at sign-in — a role switch,
   * which re-mints the token through the path that already exists — and is not
   * built.
   *
   * Filterable because resolving a session asks for exactly one row: this
   * party's role in this organization. Member metadata is also the server-side
   * allowlist, so a lookup that could not filter would read every role the party
   * holds and narrow it in memory.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:party-role.fields.organizationId',
    filterable: true,
  })
  get organizationId(): string | undefined {
    return this.#organizationId;
  }
  set organizationId(value: string | undefined) {
    this.#organizationId = value;
  }
  // #endregion
}
