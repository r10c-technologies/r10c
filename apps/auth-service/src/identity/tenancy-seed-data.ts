/**
 * Control-plane seed for the local demo tenant, in the entity wire shape.
 *
 * The point of seeding this at all is that an `Organization` is only meaningful
 * once a request resolves to its storage: with these records, signing in as a
 * vendor member resolves the catalog to `tenant_demo-organization`, and the
 * isolation is physical rather than a filter someone could forget.
 *
 * Two personas, deliberately different:
 *
 * - **Alan Turing** (`user-2`) is a member of the demo organization playing the
 *   `vendor` role. His sessions carry `activeOrganizationId`, so he reaches the
 *   catalog.
 * - **Ada Lovelace** (`user-1`) is an **operator**. She holds no membership and
 *   therefore no tenant scope, which is correct: reaching a tenant is an
 *   explicit, audited act-as-organization crossing (ADR 0012), not a wider
 *   default. Until that lands she gets `409 noActiveOrganization` from the
 *   catalog routes — a visible boundary rather than a silently empty list.
 *
 * `organizationId` is passed in rather than hardcoded because both this service
 * and marketplace-admin-service must agree on it; it lives in config-service.
 */
export const organizationSeedData = (
  organizationId: string,
): ReadonlyArray<Record<string, unknown>> => [
  {
    id: organizationId,
    name: 'Demo Vendor',
    slug: 'demo-vendor',
    status: 'active',
  },
];

/**
 * The people behind the seeded accounts, as parties rather than as logins.
 *
 * The role each plays is **not** a field here — it is a `PartyRole` record, in
 * {@link partyRoleSeedData} below. See ADR 0022 for why.
 */
export const individualSeedData: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'party-user-2',
    fullName: 'Alan Turing',
    userId: 'user-2',
  },
  {
    id: 'party-user-1',
    fullName: 'Ada Lovelace',
    userId: 'user-1',
  },
];

/**
 * The roles those two people play, as records rather than as a column.
 *
 * This is what makes the two personas a fact the system can query rather than a
 * comment: the role rides into each session and access token, so a service can
 * tell a vendor member from platform staff without inferring it from whether an
 * organization happened to resolve.
 *
 * One row each here, but the shape is the point — a party may hold several, and
 * `SessionScopeResolver` picks by reach (`operator` > `vendor` > `customer`).
 * A person with no row at all resolves to `customer`, which is the population
 * with the least reach and therefore the safest thing to be wrong about.
 */
export const partyRoleSeedData: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'party-role-user-2-vendor',
    partyId: 'party-user-2',
    role: 'vendor',
  },
  {
    id: 'party-role-user-1-operator',
    partyId: 'party-user-1',
    role: 'operator',
  },
];

/**
 * One tenant role for the demo vendor. Its grants stay inside the organization's
 * entitlement below — that is the second assignment ceiling, and seeding a role
 * that violated it would model something the platform must refuse.
 */
export const roleSeedData = (
  organizationId: string,
): ReadonlyArray<Record<string, unknown>> => [
  {
    id: 'role-demo-catalog',
    organizationId,
    name: 'Catalog',
    permissions: [
      'product-configuration-management:*:read',
      'product-configuration-management:*:write',
      'product-configuration-management:*:delete',
    ],
  },
];

/** Only Alan is a member; Ada is platform staff and deliberately is not. */
export const membershipSeedData = (
  organizationId: string,
): ReadonlyArray<Record<string, unknown>> => [
  {
    id: 'membership-user-2',
    partyId: 'party-user-2',
    organizationId,
    roleIds: ['role-demo-catalog'],
    isDefault: true,
  },
];

/**
 * What the demo organization is provisioned for.
 *
 * ⚠️ **A domain whose screens are entitlement-gated must be listed here, or the
 * vendor cannot see them at all.** `stock-management` joined the list when the
 * stock surface landed, and the omission is the failure worth remembering: the
 * slice was promoted, the service seeded, every route answered, and the sidebar
 * showed no Operaciones section — because ADR 0007's *second* ceiling is the
 * organization's provisioning, and it is independent of what the roles grant.
 * Alan holds `stock-management:stock-item:read`; his organization was not
 * provisioned for the domain, so the nav filter dropped the section and there
 * was nothing to click and no error anywhere.
 *
 * `catalog-reference` is deliberately still absent: nobody is provisioned for
 * the operator-owned platform vocabulary, and gating it would hide the
 * marketplace's own taxonomy from every vendor (ADR 0022).
 */
export const entitlementSeedData = (
  organizationId: string,
): ReadonlyArray<Record<string, unknown>> => [
  {
    id: `entitlement-${organizationId}`,
    organizationId,
    domains: [
      'product-configuration-management',
      'stock-management',
      // `order-management` joined for exactly the reason `stock-management` did,
      // and the note above is the reason it was not forgotten this time.
      'order-management',
      // `sales-management` is what makes the channels and the till visible.
      // Without it a vendor with every grant in the table sees no Ventas
      // section and no way to sell at their own counter.
      'sales-management',
      // `settlement-management` is what makes a vendor's own commercial terms
      // and their statement visible. It is here although the *records* are the
      // platform's rather than the vendor's, because being provisioned for
      // settlement is precisely what "we have terms with this organization"
      // means — and the reads are scoped to the caller, so a vendor sees their
      // own agreement and nobody else's.
      'settlement-management',
    ],
  },
];
