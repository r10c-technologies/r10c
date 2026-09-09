import type {
  GuardedNavItem,
  GuardedNavSection,
} from '@r10c/business-ts-authz';

import {
  ORDER_SURFACES,
  orderListAddress,
  permissionForOrderSurface,
} from './order-surfaces';

/**
 * This shell's contribution to a host's navigation, in the same shape
 * `MARKETPLACE_ADMIN_NAV`, `SYSTEM_MANAGEMENT_NAV` and `AUTH_NAV` use — so a
 * host concatenates rather than special-cases.
 *
 * Every field is derived from the surface: the permission from the entity's own
 * `@entity({ domain, key })`, the workspace address from its key under the
 * `operation` type. Adding an order entity is an `OrderSurface`, and this list
 * needs no line.
 *
 * The copy is `shell:`-namespaced because an `app:` key is a lint error outside
 * `apps/` (`r10c/no-foreign-app-namespace`), and rightly — copy an app authors
 * reaches a shell as a resolved string, never as a key.
 */
const navItem = (surface: {
  navLabelKey: string;
  basePath: string;
  icon: string;
}): Omit<GuardedNavItem, 'workspace' | 'permission'> => ({
  label: surface.navLabelKey,
  href: surface.basePath,
  icon: surface.icon,
});

export const ORDER_NAV: GuardedNavSection[] = [
  {
    title: 'shell:order.nav.orders',
    // Operaciones: a *process* made every record here — the checkout saga wrote
    // every order, and no person can write one. The tier's own heading
    // comes from `SCREEN_TYPE_LABEL_KEYS`, so contributing this section is the
    // whole of what makes it appear; the sidebar needs no change
    // ([ADR 0033](../../../../../docs/adr/0033-the-screen-taxonomy.md)).
    type: 'operation',
    items: ORDER_SURFACES.map(surface => ({
      ...navItem(surface),
      workspace: orderListAddress(surface),
      permission: permissionForOrderSurface(surface),
      // ⚠️ Entitlement-gated, so it carries ADR 0007's second ceiling: an
      // organization provisioned for `order-management` sees this and one
      // provisioned for nothing does not.
      //
      // ⚠️ The store is **platform** plane rather than tenant, which does not
      // change the gate but does change how the rows behind it are narrowed:
      // there is no tenant handle, so the service scopes the read with a
      // predicate built from the verified principal — a vendor sees the orders
      // that owe them a line
      // ([ADR 0053](../../../../../docs/adr/0053-scoping-a-platform-plane-read-to-its-caller.md)).
      // Hiding the item would protect nothing either way; the route is the
      // boundary.
      entitled: true,
    })),
  },
];
