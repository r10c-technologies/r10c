import {
  can,
  type GuardedNavItem,
  type GuardedNavSection,
} from '@r10c/business-ts-authz';
import { AUTH_NAV } from '@r10c/shells-next-auth/server';
import type { NavSection } from '@r10c/shells-next-common';
import { SYSTEM_MANAGEMENT_NAV } from '@r10c/shells-next-system-management';

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
 * **The** navigation definition for the back office — sidebar and workspace
 * menu both derive from it. It used to be written out twice (here and in
 * `/api/menu`), which is one place too many for two lists that must agree.
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
 * Keep only what `roles` grant, dropping any section left empty.
 *
 * `type` rides through untouched. It is the sidebar's top tier (ADR 0033), so a
 * filter that rebuilt the section without it would leave the tier unbuildable
 * downstream while every test here still passed.
 */
export const visibleNav = (roles: readonly string[]): GuardedNavSection[] =>
  NAV.map(section => ({
    title: section.title,
    type: section.type,
    items: section.items.filter(
      item => item.permission === undefined || can(roles, item.permission),
    ),
  })).filter(section => section.items.length > 0);

/**
 * The sidebar's shape: the shell's `NavSection`, without the permission.
 *
 * `label`/`title` hold catalog keys, not copy — this module is imported by a
 * server layout and by `/api/menu`, neither of which is a React component, so
 * the translate function is passed in rather than reached for through a hook.
 */
export const sidebarNav = (
  roles: readonly string[],
  translate: (key: string) => string,
): NavSection[] =>
  visibleNav(roles).map(section => ({
    title: section.title === undefined ? undefined : translate(section.title),
    items: section.items.map(({ label, href, icon, workspace }) => ({
      label: translate(label),
      href,
      icon,
      workspace,
    })),
  }));

/**
 * The workspace menu's shape: only items that can open as a tab. Translated
 * here rather than in the browser because the response is JSON, not React —
 * `/api/menu` resolves it against the request's locale.
 */
export const workspaceMenu = (
  roles: readonly string[],
  translate: (key: string) => string,
) =>
  visibleNav(roles)
    .map(section => ({
      title: section.title === undefined ? undefined : translate(section.title),
      items: section.items
        .filter(item => item.workspace !== undefined)
        .map(item => ({
          label: translate(item.label),
          param: item.workspace as string,
        })),
    }))
    .filter(section => section.items.length > 0);
