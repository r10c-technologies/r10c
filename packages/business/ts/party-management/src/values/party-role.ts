/**
 * The roles a {@link Party} can play on this platform.
 *
 * SID models `Customer` as a subclass of `PartyRole` rather than as a kind of
 * party, precisely so a party is never hard-wired as one thing: an organization
 * that sells here can buy here too, and can be a customer of a future
 * application while remaining a vendor of this one. Persona is therefore a role
 * a party *plays*, never the party's own type.
 *
 * The set is closed because it is also the plane selector — `vendor` is scoped
 * to one tenant's storage, `operator` has no tenant scope at all — and a storage
 * boundary must not be decided by a free-form string.
 */
export const PartyRoles = ['customer', 'vendor', 'operator'] as const;

export type PartyRoleName = (typeof PartyRoles)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a role name. */
export const isPartyRoleName = (value: unknown): value is PartyRoleName =>
  typeof value === 'string' &&
  (PartyRoles as readonly string[]).includes(value);

/**
 * Which data plane a role reads. Not an authorization answer — it decides which
 * storage a request resolves to, before any permission is evaluated.
 *
 * `operator` maps to `control` on purpose: an operator holds **no** tenant
 * scope, and reaching tenant data is an explicit, audited act-as-organization
 * crossing rather than a wider default (ADR 0012).
 */
export const PLANE_FOR_PARTY_ROLE = {
  customer: 'platform',
  vendor: 'tenant',
  operator: 'control',
} as const satisfies Record<PartyRoleName, 'control' | 'platform' | 'tenant'>;
