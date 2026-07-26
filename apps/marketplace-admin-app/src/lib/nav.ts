import { can, type Permission } from '@r10c/business-ts-authz';
import type { NavSection } from '@r10c/shells-next-common';

/** A nav item plus the permission its destination needs, if any. */
export interface GuardedNavItem {
  label: string;
  href: string;
  icon?: string;
  /**
   * When set, the item also offers "Open in workspace" — a link to
   * `/workspace?tab=<workspace>`.
   */
  workspace?: string;
  /** Omit to show the item to every signed-in user. */
  permission?: Permission;
}

export interface GuardedNavSection {
  title?: string;
  items: GuardedNavItem[];
}

const CATALOG = 'product-configuration-management';

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
    title: 'admin.nav.catalog',
    items: [
      {
        label: 'admin.nav.products',
        href: '/catalog/product',
        icon: '▦',
        workspace: 'catalog:product',
        permission: `${CATALOG}:product:read`,
      },
      {
        label: 'admin.nav.brands',
        href: '/catalog/product-brand',
        icon: '◈',
        workspace: 'catalog:product-brand',
        permission: `${CATALOG}:product-brand:read`,
      },
      {
        label: 'admin.nav.categories',
        href: '/catalog/product-category',
        icon: '⊞',
        workspace: 'catalog:product-category',
        permission: `${CATALOG}:product-category:read`,
      },
    ],
  },
  {
    title: 'admin.nav.account',
    items: [{ label: 'admin.nav.account', href: '/account', icon: '◕' }],
  },
];

/** Keep only what `roles` grant, dropping any section left empty. */
export const visibleNav = (roles: readonly string[]): GuardedNavSection[] =>
  NAV.map(section => ({
    title: section.title,
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
