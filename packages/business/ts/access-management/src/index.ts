/**
 * **access-management** — control plane.
 *
 * Who may do what, and where. Owns `Membership` (a party's participation in an
 * organization), `Role` (a per-organization definition and its permission list),
 * and `Entitlement` (the domains an organization is provisioned for, which is
 * also the second ceiling on what its roles may grant).
 *
 * ODA analogue: Permissions Management (TMFC035)
 *
 * Governing decision:
 * [ADR 0007](../../../../docs/adr/0007-access-model-planes-roles-entitlements.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 */
export { ACCESS_DOMAIN } from './domain';
export * from './entities/entitlement';
export * from './entities/membership';
export * from './entities/role';
export * from './values';
