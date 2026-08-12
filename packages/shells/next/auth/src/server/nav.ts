import { can, type Permission } from '@r10c/business-ts-authz';
import type { NavSection } from '@r10c/shells-next-common';
import { ACCOUNT_DESTINATIONS } from '@r10c/shells-next-common/server';

/**
 * A nav item that only appears when the caller holds `permission`.
 *
 * `label`/`title` are **namespace-qualified** catalog keys, because this table
 * mixes copy from two owners: `app:` for what auth-app authors, `shell:` for
 * the account destinations the shell owns.
 */
interface GuardedNavItem {
  label: string;
  href: string;
  icon?: string;
  /** Omit to show the item to every signed-in user. */
  permission?: Permission;
}

/**
 * `title` is required, unlike `NavSection`'s. An untitled sidebar section is a
 * shape the shell supports and this table has never wanted, and leaving it
 * optional here meant carrying a branch nothing could reach.
 */
interface GuardedNavSection {
  title: string;
  items: GuardedNavItem[];
}

/**
 * The back-office navigation, annotated with the permission each destination
 * needs. The annotation is the **same vocabulary the service guard enforces**,
 * so a menu entry and the route behind it cannot drift apart — but filtering
 * here is presentation only; auth-service is what actually refuses the request.
 */
/** Presentation only, and auth-app's to choose — the shell's list has no icons. */
const ACCOUNT_ICONS: Record<string, string> = {
  'account.profile': '◕',
  'account.security': '⚿',
  'account.sessions': '◎',
};

export const NAV: GuardedNavSection[] = [
  {
    title: 'shell:auth.nav.identity',
    items: [
      {
        label: 'shell:auth.nav.users',
        href: '/users',
        icon: '◉',
        permission: 'authn:user-identity:read',
      },
    ],
  },
  {
    title: 'shell:auth.nav.accountSection',
    // Derived from the shell's `ACCOUNT_DESTINATIONS` rather than written out
    // again: this sidebar and the account menu are the same three screens, and
    // they were drifting as two hand-kept lists. No permission on any of them —
    // your own account is not an administrative screen, and a plain `user` has
    // to be able to reach it.
    items: ACCOUNT_DESTINATIONS.map(destination => ({
      label: `shell:${destination.labelKey}`,
      href: destination.path,
      icon: ACCOUNT_ICONS[destination.labelKey],
    })),
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
    title: translate(section.title),
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
