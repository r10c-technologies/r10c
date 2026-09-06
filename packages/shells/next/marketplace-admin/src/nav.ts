import type { GuardedNavSection } from '@r10c/business-ts-authz';

import {
  MARKETPLACE_ADMIN_CATALOG_SURFACES,
  permissionForSurface,
  surfaceListAddress,
} from './catalog-surfaces';

/**
 * This shell's contribution to a host's navigation, in the same shape
 * `SYSTEM_MANAGEMENT_NAV` and `AUTH_NAV` use — so a host concatenates rather
 * than special-cases.
 *
 * These items used to live in `apps/back-office-app/src/lib/nav.ts`, which made
 * the back office the only place three of the catalog's five hand-written
 * per-entity lists could be reconciled. They belong here for the reason the
 * other two shells' do: the shell owns the screens, so it owns the way into
 * them, and a second host mounting this shell moves nothing.
 *
 * The move is why the copy is `shell:`-namespaced. An `app:` key is a lint error
 * outside `apps/` (`r10c/no-foreign-app-namespace`), and rightly — copy an app
 * authors reaches a shell as a resolved string, never as a key.
 *
 * Every field is derived from the surface: the permission from the entity's own
 * `@entity({ domain, key })`, the workspace address from its key under the
 * `master` type. Adding a catalog entity is a `CatalogSurface`, and this list
 * needs no line.
 */
export const MARKETPLACE_ADMIN_NAV: GuardedNavSection[] = [
  {
    title: 'shell:marketplaceAdmin.nav.catalog',
    // Definiciones: the operator authors these, they have no lifecycle, and an
    // offering references them (ADR 0033). "Publish" arriving on a product is
    // an action on this screen, not grounds to promote it to Operaciones.
    type: 'master',
    items: MARKETPLACE_ADMIN_CATALOG_SURFACES.map(surface => ({
      label: surface.navLabelKey,
      href: surface.basePath,
      icon: surface.icon,
      workspace: surfaceListAddress(surface),
      permission: permissionForSurface(surface),
      ...(surface.entitled === true ? { entitled: true } : {}),
    })),
  },
];
