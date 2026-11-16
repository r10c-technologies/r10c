import {
  permissionForFulfilmentSurface,
  SHIPPING_ORDER_SURFACE,
} from '@r10c/shells-next-fulfilment';
import {
  permissionForOrderSurface,
  PRODUCT_ORDER_SURFACE,
} from '@r10c/shells-next-order';
import {
  COMMISSION_ENTRY_SURFACE,
  permissionForSettlementSurface,
} from '@r10c/shells-next-settlement';
import {
  permissionForStockSurface,
  STOCK_ITEM_SURFACE,
} from '@r10c/shells-next-stock';

import { type Guarded, isNavItemVisible } from './nav';
import type { NavPrincipal } from './nav-principal';

/** Which of the vendor home's tiles this reader is shown (#563). */
export interface HomeTiles {
  readonly dispatch: boolean;
  readonly outOfStock: boolean;
  readonly latestOrders: boolean;
  readonly balance: boolean;
}

/**
 * The home's tiles, each gated by the same two ceilings as the nav item for
 * the list it leads to (ADR 0077), so a tile is shown exactly when its list is.
 * A tile the reader may not see is absent, not empty.
 *
 * ⚠️ **And only for a reader acting for an organization.** `isNavItemVisible`
 * lets an operator through on roles alone, since an operator has no
 * organization to hold entitlements; but every tile counts one organization's
 * work, so an operator sees none. Presentation only, read from unverified
 * claims: each service still decides what it answers.
 */
export function homeTiles(principal: NavPrincipal): HomeTiles {
  const shown = (permission: Guarded['permission']) =>
    principal.organizationId !== undefined &&
    isNavItemVisible({ permission, entitled: true }, principal);
  return {
    dispatch: shown(permissionForFulfilmentSurface(SHIPPING_ORDER_SURFACE)),
    outOfStock: shown(permissionForStockSurface(STOCK_ITEM_SURFACE)),
    latestOrders: shown(permissionForOrderSurface(PRODUCT_ORDER_SURFACE)),
    // The balance endpoint is guarded by the ledger's own read (#562).
    balance: shown(permissionForSettlementSurface(COMMISSION_ENTRY_SURFACE)),
  };
}
