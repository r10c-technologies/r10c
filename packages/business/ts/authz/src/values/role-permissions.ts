import { type Permission } from './permission';
import { type Role } from './role';

/**
 * Entity domains referenced by the grant table. They mirror the `domain` passed
 * to `@entity()` in each business package — named here as constants so a domain
 * rename surfaces as one edit rather than as silently dead grants.
 */
export const CATALOG_DOMAIN = 'product-configuration-management';
export const AUTHN_DOMAIN = 'authn';

/**
 * The grant table: what each role may do. This is the whole authorization
 * policy in v1 — deliberately static and readable, sitting behind the
 * `PolicyDecision` port so a richer engine can replace it without touching a
 * single call site.
 *
 * Grants are **derived at each consumer** rather than embedded in the access
 * token: the token carries only `roles`, so changing this table takes effect on
 * deploy instead of waiting out every issued token's lifetime.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Reads the catalog in the admin app; no back-office of its own.
  user: [`${CATALOG_DOMAIN}:*:read`],
  // Catalog authoring plus user management, bounded by the role-assignment rule.
  admin: [
    `${CATALOG_DOMAIN}:*:read`,
    `${CATALOG_DOMAIN}:*:write`,
    `${CATALOG_DOMAIN}:*:delete`,
    `${AUTHN_DOMAIN}:user-identity:read`,
    `${AUTHN_DOMAIN}:user-identity:write`,
    // Reading identifiers is how the user list shows who an account is; it is
    // granted explicitly rather than as `authn:*:read` so a future sensitive
    // entity in this domain is not swept in by accident.
    `${AUTHN_DOMAIN}:entity-identifier:read`,
  ],
  // The developer tier: everything, including future tooling not yet modelled.
  'super-admin': ['*:*:*'],
};
