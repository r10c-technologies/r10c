import { can, type Permission } from '@r10c/business-ts-authz';
import type { NavSection } from '@r10c/shells-next-common';

/** A nav item that only appears when the caller holds `permission`. */
interface GuardedNavItem {
  label: string;
  href: string;
  icon?: string;
  /** Omit to show the item to every signed-in user. */
  permission?: Permission;
}

interface GuardedNavSection {
  title?: string;
  items: GuardedNavItem[];
}

/**
 * The back-office navigation, annotated with the permission each destination
 * needs. The annotation is the **same vocabulary the service guard enforces**,
 * so a menu entry and the route behind it cannot drift apart — but filtering
 * here is presentation only; auth-service is what actually refuses the request.
 */
export const NAV: GuardedNavSection[] = [
  {
    title: 'auth.nav.identity',
    items: [
      {
        label: 'auth.nav.users',
        href: '/users',
        icon: '◉',
        permission: 'authn:user-identity:read',
      },
    ],
  },
];

/**
 * Keep only the sections and items the caller's roles grant, dropping empties.
 *
 * `label`/`title` hold catalog keys, not copy — this runs in a server layout,
 * not a React component, so the translate function is passed in.
 */
export const navFor = (
  roles: readonly string[],
  translate: (key: string) => string,
): NavSection[] =>
  NAV.map(section => ({
    title: section.title === undefined ? undefined : translate(section.title),
    items: section.items
      .filter(
        item => item.permission === undefined || can(roles, item.permission),
      )
      .map(({ label, href, icon }) => ({
        label: translate(label),
        href,
        icon,
      })),
  })).filter(section => section.items.length > 0);
