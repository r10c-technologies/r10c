import type { GuardedNavItem, GuardedNavSection } from '@entifix/authz';

import {
  FULFILMENT_SURFACES,
  fulfilmentListAddress,
  permissionForFulfilmentSurface,
} from './fulfilment-surfaces';

const navItem = (surface: {
  navLabelKey: string;
  basePath: string;
  icon: string;
}): Omit<GuardedNavItem, 'workspace' | 'permission'> => ({
  label: surface.navLabelKey,
  href: surface.basePath,
  icon: surface.icon,
});

/**
 * This shell's contribution to a host's navigation, in the shape every other
 * shell's nav uses, so a host concatenates rather than special-cases. Every
 * field is derived from the surface.
 */
export const FULFILMENT_NAV: GuardedNavSection[] = [
  {
    title: 'r10c:fulfilment.nav.title',
    // Operaciones: the checkout flow opened every shipment here, and no person
    // can (ADR 0033).
    type: 'operation',
    items: FULFILMENT_SURFACES.map(surface => ({
      ...navItem(surface),
      workspace: fulfilmentListAddress(surface),
      permission: permissionForFulfilmentSurface(surface),
      // ⚠️ Entitlement-gated (ADR 0037): an organization provisioned for
      // `shipping-order-management` sees this and one provisioned for nothing
      // does not. Hiding it protects nothing — fulfilment-service's routes are
      // the boundary, and they answer `403` to the same organization.
      entitled: true,
    })),
  },
];
