import { type Permission } from './permission';
import { type Role } from './role';

/**
 * Entity domains referenced by the grant table. They mirror the `domain` passed
 * to `@entity()` in each business package — named here as constants so a domain
 * rename surfaces as one edit rather than as silently dead grants.
 */
export const CATALOG_DOMAIN = 'product-configuration-management';
export const CATALOG_REFERENCE_DOMAIN = 'catalog-reference';
export const SALES_DOMAIN = 'sales-management';
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
  user: [
    `${CATALOG_DOMAIN}:*:read`,
    `${CATALOG_REFERENCE_DOMAIN}:*:read`,
    // Seeing which counters exist, so a member of staff can be shown the one
    // they are standing at. Authoring them is an `admin` act.
    `${SALES_DOMAIN}:*:read`,
  ],
  // Catalog authoring plus user management, bounded by the role-assignment rule.
  admin: [
    `${CATALOG_DOMAIN}:*:read`,
    `${CATALOG_DOMAIN}:*:write`,
    `${CATALOG_DOMAIN}:*:delete`,
    // The platform vocabulary an offering is classified in: **read only**.
    // marketplace-service serves these reads to anonymous storefront traffic,
    // so granting them here is not a privilege — it only lets the nav name the
    // same permission the destination needs. Authoring stays with `super-admin`:
    // ADR 0022 makes `catalog-reference` operator-owned, because a tenant role
    // that could write it would let one vendor rewrite the browse tree every
    // other vendor is classified into.
    `${CATALOG_REFERENCE_DOMAIN}:*:read`,
    // A vendor's own selling channels, authored in full — the mirror image of
    // the line above rather than a copy of it. `catalog-reference` is read-only
    // here because it is operator-owned platform vocabulary that every vendor
    // shares; a `SalesChannel` is tenant-plane and belongs to the one
    // organization whose handle the request resolved to, so writing it can
    // reach nobody else's data (ADR 0024).
    `${SALES_DOMAIN}:*:read`,
    `${SALES_DOMAIN}:*:write`,
    `${SALES_DOMAIN}:*:delete`,
    `${AUTHN_DOMAIN}:user-identity:read`,
    `${AUTHN_DOMAIN}:user-identity:write`,
    // Two use-case verbs, not CRUD. Changing somebody's role or status and
    // ending every session they hold are acts a generic `write` was standing in
    // for; naming them is what lets a surface offer them and a route guard say
    // what it is guarding (ADR 0026).
    //
    // Written as literals rather than imported from the use cases that declare
    // them: this package is `business:policy`, which may depend only on
    // `layer:entifix`/`layer:utils`, so it cannot reach a domain package. The
    // source scan in `@r10c/slices` is what keeps these two strings and the
    // `@useCase()` declarations from drifting apart.
    `${AUTHN_DOMAIN}:user-identity:update-aspects`,
    `${AUTHN_DOMAIN}:user-identity:revoke-sessions`,
    // Reading identifiers is how the user list shows who an account is; it is
    // granted explicitly rather than as `authn:*:read` so a future sensitive
    // entity in this domain is not swept in by accident.
    `${AUTHN_DOMAIN}:entity-identifier:read`,
    // Seeing where a user is signed in — incident response. Note this is
    // another person's device and IP history, so it is granted deliberately and
    // not folded into `user-identity:read`.
    //
    // Read only. Ending those sessions used to ride on `user-device:write`,
    // which named the record they are listed against rather than the act; it is
    // now `user-identity:revoke-sessions` above, and nothing writes a
    // `UserDevice` through a guarded route, so the write grant is gone rather
    // than left behind to look like it still authorizes something.
    `${AUTHN_DOMAIN}:user-device:read`,
  ],
  // The developer tier: everything, including future tooling not yet modelled.
  'super-admin': [
    '*:*:*',
    // Declared explicitly although the line above already covers it.
    //
    // `*:*:*` is the catch-all for capabilities that do not exist yet; it is
    // not a substitute for naming a verb that does. `@r10c/slices` asserts that
    // every declared verb appears in some grant, and a wildcard satisfying that
    // check would make it vacuous for exactly the verbs most worth checking —
    // the ones only the operator holds.
    //
    // Retiring the shared brand and category vocabulary is `super-admin`'s
    // alone, and deliberately not `admin`'s: ADR 0022 makes `catalog-reference`
    // operator-owned, because a tenant role that could retire a brand would let
    // one vendor take a classification away from every other vendor using it.
    // The entityKey segment is wildcarded (both entities, one lifecycle); the
    // **action** segment is not, which is what keeps ADR 0026's residual intact
    // — no role but `super-admin` wildcards an action, so a new verb still
    // escalates to nobody.
    `${CATALOG_REFERENCE_DOMAIN}:*:retire`,
  ],
};
