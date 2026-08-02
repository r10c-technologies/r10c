import type { Permission } from '@r10c/business-ts-authz';

/** The `<domain>` segment of a permission — the first of three. */
const domainOf = (permission: Permission): string =>
  permission.slice(0, permission.indexOf(':'));

/**
 * May an organization's role grant this permission?
 *
 * The second assignment ceiling: the first is the actor's own tier
 * (`canAssignRole` in `business-ts-authz`), and this one is what the
 * organization actually bought. A vendor cannot mint a role granting
 * `stock-management:*:write` unless it is provisioned for stock, no matter how
 * senior the person minting it.
 *
 * A `*` domain is refused rather than treated as a wildcard. Wildcards belong to
 * *granted* platform permissions, where the grant table is code we wrote; a
 * tenant-authored role naming `*` as its domain would grant every domain the
 * platform ever adds, including ones this organization has not bought.
 */
export const isPermissionEntitled = (
  entitledDomains: readonly string[],
  permission: Permission,
): boolean => {
  const domain = domainOf(permission);
  return domain !== '*' && entitledDomains.includes(domain);
};

/**
 * Every permission in `permissions` that the organization may not grant. Empty
 * means the role is assignable. Returning the offenders rather than a boolean is
 * what lets the caller answer *which* domain is missing instead of a bare `403`.
 */
export const unentitledPermissions = (
  entitledDomains: readonly string[],
  permissions: readonly Permission[],
): readonly Permission[] =>
  permissions.filter(
    permission => !isPermissionEntitled(entitledDomains, permission),
  );
