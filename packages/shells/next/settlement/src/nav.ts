import type {
  GuardedNavItem,
  GuardedNavSection,
} from '@r10c/business-ts-authz';

import {
  permissionForSettlementSurface,
  SETTLEMENT_MASTER_SURFACES,
  SETTLEMENT_OPERATION_SURFACES,
  settlementListAddress,
  type SettlementSurface,
} from './settlement-surfaces';

/**
 * This shell's contribution to a host's navigation, in the same shape
 * `MARKETPLACE_ADMIN_NAV`, `STOCK_NAV`, `SALES_NAV` and `AUTH_NAV` use — so a
 * host concatenates rather than special-cases.
 *
 * ⚠️ **Two sections rather than one, because this domain spans two tiers.**
 * Every other domain shell contributes a single section; an `Agreement` is
 * authored and the other three are produced, and ADR 0033's test puts those in
 * different tiers. Each section's heading comes from `SCREEN_TYPE_LABEL_KEYS`,
 * so contributing them is the whole of what makes both appear — the sidebar
 * needs no change, and `groupByScreenType` merges these with every other shell's
 * sections of the same type.
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

const itemsFor = (surfaces: readonly SettlementSurface[]): GuardedNavItem[] =>
  surfaces.map(surface => ({
    ...navItem(surface),
    workspace: settlementListAddress(surface),
    permission: permissionForSettlementSurface(surface),
    // ⚠️ **Entitlement-gated, although the records are the platform's rather
    // than the vendor's.** Being provisioned for settlement is precisely what
    // "we have commercial terms with this organization" means, and every read
    // behind these items is narrowed to the caller — so a vendor sees their own
    // agreement and their own statement and nobody else's. That is the
    // difference from `catalog-reference`, which is operator-owned vocabulary
    // every vendor shares and is deliberately not gated
    // ([ADR 0007](../../../../../docs/adr/0007-access-model-planes-roles-entitlements.md)).
    entitled: true,
  }));

export const SETTLEMENT_NAV: GuardedNavSection[] = [
  {
    title: 'shell:settlement.nav.settlement',
    // Definiciones: somebody authors an agreement, and every settled sale then
    // references it.
    type: 'master',
    items: itemsFor(SETTLEMENT_MASTER_SURFACES),
  },
  {
    title: 'shell:settlement.nav.settlement',
    // Operaciones: a process made every one of these. A captured sale writes
    // the entry, a sweep opens the run, the run folds the payout.
    type: 'operation',
    items: itemsFor(SETTLEMENT_OPERATION_SURFACES),
  },
];
