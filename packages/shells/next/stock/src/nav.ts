import type {
  GuardedNavItem,
  GuardedNavSection,
} from '@r10c/business-ts-authz';

import {
  permissionForStockSurface,
  STOCK_SURFACES,
  stockListAddress,
} from './stock-surfaces';

/**
 * This shell's contribution to a host's navigation, in the same shape
 * `MARKETPLACE_ADMIN_NAV`, `SYSTEM_MANAGEMENT_NAV` and `AUTH_NAV` use — so a
 * host concatenates rather than special-cases.
 *
 * Every field is derived from the surface: the permission from the entity's own
 * `@entity({ domain, key })`, the workspace address from its key under the
 * `operation` type. Adding a stock entity is a `StockSurface`, and this list
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

export const STOCK_NAV: GuardedNavSection[] = [
  {
    title: 'shell:stock.nav.stock',
    // Operaciones: a *process* made every record here — a movement upserts the
    // item, and the checkout crossing writes the hold. The tier's own heading
    // comes from `SCREEN_TYPE_LABEL_KEYS`, so contributing this section is the
    // whole of what makes it appear; the sidebar needs no change
    // ([ADR 0033](../../../../../docs/adr/0033-the-screen-taxonomy.md)).
    type: 'operation',
    items: STOCK_SURFACES.map(surface => ({
      ...navItem(surface),
      workspace: stockListAddress(surface),
      permission: permissionForStockSurface(surface),
      // ⚠️ Tenant-plane and vendor-owned, so it carries ADR 0007's second
      // ceiling: an organization provisioned for `stock-management` sees these
      // and one provisioned for nothing does not. Unlike `catalog-reference`,
      // which is operator-owned platform vocabulary every vendor shares, a
      // vendor's stock position is the vendor's alone.
      entitled: true,
    })),
  },
];
