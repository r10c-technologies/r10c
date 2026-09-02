import { isPermissionEntitled } from '@r10c/business-ts-access-management';
import {
  can,
  type GuardedNavItem,
  type GuardedNavSection,
} from '@r10c/business-ts-authz';
import { AUTH_NAV } from '@r10c/shells-next-auth/server';
import type { NavSection } from '@r10c/shells-next-common';
import { SYSTEM_MANAGEMENT_NAV } from '@r10c/shells-next-system-management';

import type { NavPrincipal } from './nav-principal';

export type { GuardedNavItem, GuardedNavSection };

const CATALOG = 'product-configuration-management';
/**
 * Brands and categories are not in the catalog domain any more — ADR 0022 moved
 * them to the platform-plane `catalog-reference` store, and a nav item naming a
 * permission its destination does not check is exactly the drift this file is
 * written to avoid.
 */
const CATALOG_REFERENCE = 'catalog-reference';

/**
 * **The** navigation definition for the back office, and now its only one. It
 * was written out twice — here and in a `/api/menu` route serving a second
 * projection — which is one place too many for two lists that must agree. That
 * route was deleted rather than kept in step: nothing had ever fetched it, in
 * any revision, because the workspace deliberately reuses this same sidebar.
 *
 * Each item names the permission its destination needs, in the same vocabulary
 * `requirePermission` enforces on the service, so an entry and the route behind
 * it cannot drift. Filtering is still presentation: marketplace-admin-service
 * is what refuses the request.
 */
export const NAV: GuardedNavSection[] = [
  {
    title: 'app:admin.nav.catalog',
    // Definiciones: the operator authors these, they have no lifecycle, and an
    // offering references them (ADR 0033). "Publish" arriving on a product is
    // an action on this screen, not grounds to promote it to Operaciones.
    type: 'master',
    items: [
      {
        label: 'app:admin.nav.products',
        href: '/catalog/product',
        icon: '▦',
        workspace: 'catalog:product-specification',
        permission: `${CATALOG}:product-specification:read`,
        // The one item here an organization is actually provisioned for. Brands
        // and categories below are `catalog-reference`, which ADR 0022 makes
        // permanently non-grantable — a marketplace has to merge taxonomy, so
        // no vendor buys it and none may be refused it.
        entitled: true,
      },
      {
        label: 'app:admin.nav.brands',
        href: '/catalog/product-brand',
        icon: '◈',
        workspace: 'catalog:product-brand',
        permission: `${CATALOG_REFERENCE}:product-brand:read`,
      },
      {
        label: 'app:admin.nav.categories',
        href: '/catalog/product-category',
        icon: '⊞',
        workspace: 'catalog:product-category',
        permission: `${CATALOG_REFERENCE}:product-category:read`,
      },
    ],
  },
  // Contributed by the `scope:shared` system-management shell, which owns both
  // the screens and their copy — so mounting it in a second host later moves
  // nothing. Its items carry `config:configuration:*`, which only `super-admin`
  // holds, so the section simply disappears for everyone else.
  ...SYSTEM_MANAGEMENT_NAV,
  // Contributed by the auth shell, which owns user administration and the
  // account screens along with their copy. This host mounts both domains, so
  // the sidebar is a concatenation rather than a rewrite — and dropping the
  // auth surface again is dropping this line.
  ...AUTH_NAV,
];

/**
 * Is this item reachable by `principal` — under both ceilings?
 *
 * The first is what the person's roles grant; the second is what their
 * organization was provisioned for (ADR 0007). They are independent, and an
 * item can be refused by either.
 */
export const isNavItemVisible = (
  item: GuardedNavItem,
  principal: NavPrincipal,
): boolean => {
  if (item.entitled === true && item.permission === undefined) {
    // There is no domain to read. Showing it and hiding it are both wrong, and
    // both look like a bug in something else — a missing grant, or a missing
    // entitlement — so this fails at the declaration instead.
    throw new Error(
      `Nav item "${item.label}" is entitlement-gated but names no permission`,
    );
  }
  if (item.permission === undefined) {
    return true;
  }
  if (!can(principal.roles, item.permission)) {
    return false;
  }
  // A session acting for no organization — an operator, a buyer — is outside
  // the entitlement ceiling rather than refused by it. Keying this on the
  // organization instead of on an empty entitlement list is what keeps an
  // operator's sidebar from emptying itself.
  if (principal.organizationId === undefined || item.entitled !== true) {
    return true;
  }
  return isPermissionEntitled(principal.entitlements, item.permission);
};

/**
 * Keep only what `principal` may reach, dropping any section left empty.
 *
 * `type` rides through untouched. It is the sidebar's top tier (ADR 0033), so a
 * filter that rebuilt the section without it would leave the tier unbuildable
 * downstream while every test here still passed.
 */
export const visibleNav = (principal: NavPrincipal): GuardedNavSection[] =>
  NAV.map(section => ({
    title: section.title,
    type: section.type,
    items: section.items.filter(item => isNavItemVisible(item, principal)),
  })).filter(section => section.items.length > 0);

/**
 * The sidebar's shape: the shell's `NavSection`, without the permission.
 *
 * `label`/`title` hold catalog keys, not copy — this module is imported by a
 * server layout, which is not a React component that may call a hook, so the
 * translate function is passed in rather than reached for.
 */
export const sidebarNav = (
  principal: NavPrincipal,
  translate: (key: string) => string,
): NavSection[] =>
  visibleNav(principal).map(section => ({
    title: section.title === undefined ? undefined : translate(section.title),
    items: section.items.map(({ label, href, icon, workspace }) => ({
      label: translate(label),
      href,
      icon,
      workspace,
    })),
  }));
