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
 *   default. Until that lands she gets `409 no-active-organization` from the
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
 * `partyRole` is what makes the two personas above a field rather than a
 * comment: it rides into each session and access token, so a service can tell a
 * vendor member from platform staff without inferring it from whether an
 * organization happened to resolve.
 */
export const individualSeedData: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'party-user-2',
    fullName: 'Alan Turing',
    userId: 'user-2',
    partyRole: 'vendor',
  },
  {
    id: 'party-user-1',
    fullName: 'Ada Lovelace',
    userId: 'user-1',
    partyRole: 'operator',
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

/** What the demo organization is provisioned for. */
export const entitlementSeedData = (
  organizationId: string,
): ReadonlyArray<Record<string, unknown>> => [
  {
    id: `entitlement-${organizationId}`,
    organizationId,
    domains: ['product-configuration-management'],
  },
];
