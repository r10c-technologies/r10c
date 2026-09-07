import type {
  GuardedNavItem,
  GuardedNavSection,
  Permission,
} from '@r10c/business-ts-authz';

import {
  MARKETPLACE_ADMIN_CATALOG_SURFACES,
  permissionForSurface,
  surfaceListAddress,
} from './catalog-surfaces';
import {
  MARKETPLACE_ADMIN_WIZARD_SURFACES,
  permissionForWizard,
  wizardAddress,
} from './wizard-surfaces';

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
/**
 * One nav item, from whichever surface declares it.
 *
 * Shared by both sections so the entitlement spread is written once: two copies
 * of a conditional that each only ever see one of its answers is how the two
 * stop agreeing about what an ungated surface looks like.
 */
const navItem = (
  surface: {
    navLabelKey: string;
    basePath: string;
    icon: string;
    entitled?: boolean;
  },
  workspace: string,
  permission: Permission,
): GuardedNavItem => ({
  label: surface.navLabelKey,
  href: surface.basePath,
  icon: surface.icon,
  workspace,
  permission,
  ...(surface.entitled === true ? { entitled: true } : {}),
});

export const MARKETPLACE_ADMIN_NAV: GuardedNavSection[] = [
  {
    title: 'shell:marketplaceAdmin.nav.catalog',
    // Definiciones: the operator authors these, they have no lifecycle, and an
    // offering references them (ADR 0033). "Publish" arriving on a product is
    // an action on this screen, not grounds to promote it to Operaciones.
    type: 'master',
    items: MARKETPLACE_ADMIN_CATALOG_SURFACES.map(surface =>
      navItem(
        surface,
        surfaceListAddress(surface),
        permissionForSurface(surface),
      ),
    ),
  },
  {
    title: 'shell:marketplaceAdmin.nav.guided',
    // Asistentes: guided, multi-step, and it ends (ADR 0033). The tier's own
    // heading comes from `SCREEN_TYPE_LABEL_KEYS`, so contributing this section
    // is the whole of what makes it appear — the sidebar needs no change.
    type: 'wizard',
    // `write`, not `read`: the flow's whole purpose is to create a record, so
    // offering it to someone who may only read is offering a dead end.
    items: MARKETPLACE_ADMIN_WIZARD_SURFACES.map(surface =>
      navItem(surface, wizardAddress(surface), permissionForWizard(surface)),
    ),
  },
];
