'use client';

import {
  Reservation,
  StockItem,
  StockMovement,
} from '@r10c/business-ts-stock-management';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import type { EntityCrud } from '@r10c/shells-next-common';
import { makeEntityCrud } from '@r10c/shells-next-common';

import {
  RESERVATION_SURFACE,
  STOCK_ITEM_SURFACE,
  STOCK_MOVEMENT_SURFACE,
} from '../stock-surfaces';
import { useStockAdapters } from './stock-context';

/**
 * The stock domain's three screens, declared rather than written.
 *
 * The same factory the catalog's Definiciones screens come out of, which is the
 * thing worth stating: `makeEntityCrud` is bounded by its **floorplan** — a
 * list plus a single-record page — not by the screen type. A record produced by
 * a process is as generable as one somebody authored; what it cannot generate
 * is a wizard or a report.
 *
 * ⚠️ **No `onHand` or `reserved` input anywhere here, and no client flag makes
 * that so.** Both are `type: 'number'` accessors, which is exactly what the
 * generator would otherwise turn into editable fields with a Save that `PUT`s
 * an absolute quantity — the read-modify-write
 * [ADR 0010](../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)
 * forbids. What prevents it is the **served descriptor**: no role holds
 * `stock-management:stock-item:write`, stock-service serves no save route, so
 * `$metadata` reports no Save affordance and the form renders read-only.
 *
 * Suppressing the fields with `hiddenFields` instead would have been the
 * tempting one-liner and would be worse: `hiddenFields` drops a member from the
 * rendered fields and **not** from its validation rule, so a hidden required
 * member fails validation with no field to show it on — Save does nothing and
 * says nothing.
 *
 * The write surface is the movement below.
 */
const STOCK_METADATA = makeEntityMetadataSource({
  url: name => `/api/stock/${name}/$metadata`,
});

export const stockItemCrud: EntityCrud<StockItem> = makeEntityCrud(StockItem, {
  useAdapters: useStockAdapters,
  basePath: STOCK_ITEM_SURFACE.basePath,
  catalogKey: STOCK_ITEM_SURFACE.entityKey,
  repository: 'stockItemRest',
  configuration: 'configurationStore',
  // `id` only. Both counters stay visible — a stock screen that hid the
  // quantities would have nothing left to show — they are simply not editable,
  // and the metadata is what says so.
  hiddenFields: ['id'],
  metadataSource: STOCK_METADATA,
});

/**
 * The one write surface in this domain, and an ordinary generated form.
 *
 * A movement is a signed `quantity` plus a `reason`, and the two are checked
 * against each other server-side (`isConsistentMovement`) — a `sale` with a
 * positive quantity is refused `400` rather than silently increasing the total.
 * The enum control comes from the accessor's own `enumValues`.
 *
 * No custom action and no verb: recording a movement *is* the create, so the
 * generated new-record form posting `POST /api/stock-movement` is the whole of
 * it. There is deliberately no `PUT` and no `DELETE` behind the ledger — it is
 * append-only, and the served descriptor withholds both.
 */
export const stockMovementCrud: EntityCrud<StockMovement> = makeEntityCrud(
  StockMovement,
  {
    useAdapters: useStockAdapters,
    basePath: STOCK_MOVEMENT_SURFACE.basePath,
    catalogKey: STOCK_MOVEMENT_SURFACE.entityKey,
    repository: 'stockMovementRest',
    configuration: 'configurationStore',
    // Server-owned: `record-movement.ts` assigns it with `randomUUID()`, so
    // asking an operator to type one would be asking for a value the service
    // overwrites.
    hiddenFields: ['id'],
    metadataSource: STOCK_METADATA,
  },
);

/**
 * Holds, read-only.
 *
 * Written by the checkout crossing rather than by a person — `id`, `status` and
 * `expiresAt` are all assigned by the route — so this exists to make an expiry
 * visible: a hold that quietly ends is the hardest thing to answer a vendor's
 * "why did this buyer lose their basket?" with.
 */
export const reservationCrud: EntityCrud<Reservation> = makeEntityCrud(
  Reservation,
  {
    useAdapters: useStockAdapters,
    basePath: RESERVATION_SURFACE.basePath,
    catalogKey: RESERVATION_SURFACE.entityKey,
    repository: 'reservationRest',
    configuration: 'configurationStore',
    hiddenFields: ['id'],
    metadataSource: STOCK_METADATA,
  },
);

/**
 * Every generated stock screen, for the host's workspace registry to derive its
 * `operation:` tabs from — the same list the nav and the search sources come
 * from, so a fourth entity is one `StockSurface` and one `makeEntityCrud` call.
 */
export const STOCK_CRUDS = [
  stockItemCrud,
  stockMovementCrud,
  reservationCrud,
] as const;

export const StockItemListClientPage = stockItemCrud.ListPage;
export const StockItemSingleViewClientPage = stockItemCrud.SingleViewPage;
export const StockMovementListClientPage = stockMovementCrud.ListPage;
export const StockMovementSingleViewClientPage =
  stockMovementCrud.SingleViewPage;
export const ReservationListClientPage = reservationCrud.ListPage;
export const ReservationSingleViewClientPage = reservationCrud.SingleViewPage;
