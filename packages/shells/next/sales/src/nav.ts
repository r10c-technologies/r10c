import type {
  GuardedNavItem,
  GuardedNavSection,
} from '@r10c/business-ts-authz';
import { screenAddress } from '@r10c/business-ts-authz';
import { SELL_AT_CHANNEL } from '@r10c/business-ts-sales-management';

import {
  COUNTER_SALE_SURFACE,
  permissionForSalesSurface,
  SALES_SURFACES,
  salesListAddress,
} from './sales-surfaces';

/**
 * This shell's contribution to a host's navigation, in the same shape the other
 * shells' contributions use — so a host concatenates rather than special-cases.
 *
 * Two sections rather than one, because the two screens are two **tiers** of the
 * taxonomy and the tier is what the sidebar groups by: a channel is Definiciones
 * (a vendor names their counter, and orders then reference it), the till is an
 * Asistente (a guided flow that ends in a hand-off). Putting the till under
 * Definiciones would have been one line shorter and would have told the reader
 * that selling is a kind of configuration.
 *
 * The copy is `shell:`-namespaced because an `app:` key is a lint error outside
 * `apps/` (`r10c/no-foreign-app-namespace`).
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

export const SALES_NAV: GuardedNavSection[] = [
  {
    title: 'shell:sales.nav.sales',
    type: 'master',
    items: SALES_SURFACES.map(surface => ({
      ...navItem(surface),
      workspace: salesListAddress(surface),
      permission: permissionForSalesSurface(surface),
      // ⚠️ Tenant-plane and vendor-owned, so it carries ADR 0007's second
      // ceiling: an organization provisioned for `sales-management` sees these
      // and one provisioned for nothing does not.
      entitled: true,
    })),
  },
  {
    title: 'shell:sales.nav.guided',
    type: 'wizard',
    items: [
      {
        ...navItem(COUNTER_SALE_SURFACE),
        workspace: screenAddress({
          type: 'wizard',
          key: COUNTER_SALE_SURFACE.key,
        }),
        // The verb, so a member of staff who may sell sees the till and a role
        // that may only read channels does not.
        permission: SELL_AT_CHANNEL,
        entitled: true,
      },
    ],
  },
];
