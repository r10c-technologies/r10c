import {
  type GuardedCommand,
  NEW_COMMAND_PAGE,
  permissionForEntity,
} from '@r10c/business-ts-authz';
import { CATALOG_NEW_SLUG } from '@r10c/shells-next-common/server';

import { MARKETPLACE_ADMIN_CATALOG_SURFACES } from './catalog-surfaces';

/**
 * This shell's contribution to a host's command palette, in the same shape
 * `MARKETPLACE_ADMIN_NAV` uses — so a host concatenates rather than
 * special-cases.
 *
 * Derived from the same `CatalogSurface` the nav, the CRUD pages, the workspace
 * registry and the search sources come from, so a fourth catalog entity gains a
 * create command with no line here. `${basePath}/${CATALOG_NEW_SLUG}` is the
 * route the generated single-view page already serves — the literal is the
 * factory's own, not restated.
 *
 * The permission is `write`, not `read`: this command opens a form for a record
 * that does not exist, and offering it to somebody who may only look is an
 * invitation to a `403`. It is derived from the entity's own
 * `@entity({ domain, key })` for the same reason the nav's is.
 *
 * Every one sits on the create page rather than the root. Three "Nuevo X" rows
 * competing with the destinations they resemble is exactly what the page stack
 * is for.
 */
export const MARKETPLACE_ADMIN_COMMANDS: GuardedCommand[] =
  MARKETPLACE_ADMIN_CATALOG_SURFACES.map(surface => ({
    key: `new:${surface.entityKey}`,
    // The entity's own "new" form title — "Nuevo producto", "Nueva marca" —
    // rather than a verb interpolated with the label, because Spanish inflects
    // the adjective for the noun's gender and a shared template is wrong for
    // half of them. `EntityCatalogKey` guarantees the subtree exists.
    labelKey: `entity:${surface.entityKey}.form.newTitle`,
    href: `${surface.basePath}/${CATALOG_NEW_SLUG}`,
    page: NEW_COMMAND_PAGE,
    permission: permissionForEntity(surface.entityConstructor, 'write'),
    ...(surface.entitled === true ? { entitled: true } : {}),
  }));
