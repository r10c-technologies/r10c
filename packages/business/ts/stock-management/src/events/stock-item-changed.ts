import {
  type AggregateRef,
  type DomainEvent,
  openStruct,
  registerEvent,
} from '@entifix/core';
import { type SaleUnit, SaleUnits } from '@r10c/business-ts-sales-vocabulary';
import { Schema } from 'effect';

/**
 * One offering's stock moved: a delivery or a sale, a hold taken, released or
 * converted, goods put back. Routing key and register name.
 *
 * It is what lets availability be pushed: a vendor's open back-office tab and
 * — through a published hint — nothing else, since a vendor's stock position is
 * exactly what a competitor would want (ADR 0010, ADR 0072).
 */
export const STOCK_ITEM_CHANGED = 'stock-item.changed';

/** What a change says: the item's counters as the unit that moved them left them. */
export interface StockItemChange {
  readonly id: string;
  readonly offeringId: string;
  /** What every counter here is counted in (ADR 0082 §4). */
  readonly unit: SaleUnit;
  readonly onHand: number;
  readonly reserved: number;
  /** `onHand - reserved`, as the same update left it. */
  readonly available: number;
}

export const StockItemChangeSchema = openStruct({
  id: Schema.NonEmptyString,
  offeringId: Schema.NonEmptyString,
  unit: Schema.Literals(SaleUnits),
  onHand: Schema.Finite,
  reserved: Schema.Finite,
  available: Schema.Finite,
});

// Audience required: a change is the vendor's own, and fails closed to nobody
// when it names none.
registerEvent(STOCK_ITEM_CHANGED, StockItemChangeSchema, {
  versioned: true,
  audience: 'required',
});

/**
 * A change as a routable message from `source`, for the one organization
 * whose store it moved. The item is the aggregate and its ledger sequence the
 * version, incremented in the same unit as the counters, so a consumer orders
 * two changes to one item and never applies an older over a newer.
 */
export const stockItemChangedEvent = (
  organizationId: string,
  change: StockItemChange & { readonly version: number },
  source: string,
): DomainEvent<StockItemChange> & {
  aggregate: AggregateRef;
  version: number;
} => ({
  name: STOCK_ITEM_CHANGED,
  id: `${change.id}:${String(change.version)}`,
  source,
  at: new Date().toISOString(),
  correlationId: change.offeringId,
  aggregate: { type: 'stock-item', id: change.id },
  version: change.version,
  audience: [{ kind: 'organization', id: organizationId }],
  data: {
    id: change.id,
    offeringId: change.offeringId,
    unit: change.unit,
    onHand: change.onHand,
    reserved: change.reserved,
    available: change.available,
  },
});
