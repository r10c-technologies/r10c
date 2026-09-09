import { isPermissionEntitled } from '@r10c/business-ts-access-management';
import {
  can,
  type GuardedNavItem,
  type GuardedNavSection,
} from '@r10c/business-ts-authz';
import { AUTH_NAV } from '@r10c/shells-next-auth/server';
import type { NavSection } from '@r10c/shells-next-common';
import { MARKETPLACE_ADMIN_NAV } from '@r10c/shells-next-marketplace-admin/server';
import { ORDER_NAV } from '@r10c/shells-next-order/server';
import { STOCK_NAV } from '@r10c/shells-next-stock/server';
import { SYSTEM_MANAGEMENT_NAV } from '@r10c/shells-next-system-management';

import type { NavPrincipal } from './nav-principal';

export type { GuardedNavItem, GuardedNavSection };

/**
 * **The** navigation definition for the back office, and now only a
 * concatenation.
 *
 * It used to author the catalog's three items here, which made this app the one
 * place three of the catalog's five hand-written per-entity lists could be
 * reconciled — and the domain strings they named were written out by hand beside
 * permissions the services derive from `@entity()`. Every contributing shell now
 * owns its own fragment, so this file composes and nothing more; the order is
 * the only decision left in it.
 *
 * Filtering is still presentation: the services are what refuse the request.
 */
export const NAV: GuardedNavSection[] = [
  // Contributed by the marketplace-admin shell, which owns the catalog's screens
  // and their copy — and derives each item from the same `CatalogSurface` the
  // pages, the tabs and the search sources come from.
  ...MARKETPLACE_ADMIN_NAV,
  // Contributed by the stock shell — the first Operaciones section, and the
  // sidebar needed no change to render it: the tier comes from the section's
  // own `type`, and its heading from `SCREEN_TYPE_LABEL_KEYS` (ADR 0033).
  ...STOCK_NAV,
  // Contributed by the order shell, into the same Operaciones tier — a process
  // wrote every record in both, which is what the tier means (ADR 0033).
  ...ORDER_NAV,
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
 * The gated half of a nav item — or of a palette command, which is gated the
 * same way and by the same two ceilings.
 *
 * Structural rather than a union, so a third kind of guarded affordance costs no
 * edit here. What must not happen is a second filter beside this one: two rules
 * that could disagree about the same permission is exactly the drift the shared
 * `business:policy` vocabulary exists to prevent.
 */
export interface Guarded {
  label?: string;
  labelKey?: string;
  permission?: GuardedNavItem['permission'];
  entitled?: boolean;
}

/**
 * Is this item reachable by `principal` — under both ceilings?
 *
 * The first is what the person's roles grant; the second is what their
 * organization was provisioned for (ADR 0007). They are independent, and an
 * item can be refused by either.
 */
export const isNavItemVisible = (
  item: Guarded,
  principal: NavPrincipal,
): boolean => {
  if (item.entitled === true && item.permission === undefined) {
    // There is no domain to read. Showing it and hiding it are both wrong, and
    // both look like a bug in something else — a missing grant, or a missing
    // entitlement — so this fails at the declaration instead.
    throw new Error(
      `Nav item "${item.label ?? item.labelKey}" is entitlement-gated but names no permission`,
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
    // `type` rides through here too, and this was the hop that dropped it: the
    // field was declared on every shell's fragment and propagated by
    // `visibleNav`, then thrown away one line before the sidebar could group by
    // it. It is a `ScreenType`, not copy — the sidebar resolves its own label
    // from `SCREEN_TYPE_LABEL_KEYS`, which is `shell:` namespaced and therefore
    // not this app's to translate.
    type: section.type,
    items: section.items.map(({ label, href, icon, workspace }) => ({
      label: translate(label),
      href,
      icon,
      workspace,
    })),
  }));
