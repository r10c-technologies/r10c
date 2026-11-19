import {
  type AggregateRef,
  type DomainEvent,
  openStruct,
  registerEvent,
} from '@entifix/core';
import { Schema } from 'effect';

import type { StockMovement } from '../entities/stock-movement';

/**
 * A line was written to the stock ledger. Routing key and register name.
 *
 * The movement itself, as a whole fact (ADR 0078 §2): a module that keeps books
 * from stock — cost control, accounting — writes its record from this event and
 * its own store, and never reads the ledger back.
 *
 * ⚠️ **A second event, not a wider `stock-item.changed`.** That one is a counter
 * for a screen, pushed to the vendor's open tabs; widening it would put a ledger
 * line in a payload a browser receives. This one is registered with
 * `audience: 'none'`, so the realtime slice pushes it to nobody.
 */
export const STOCK_MOVEMENT_RECORDED = 'stock-movement.recorded';

/** What a recorded movement says. */
export interface StockMovementRecord {
  readonly id: string;
  /**
   * Whose ledger the line was written to. An entity is organization-agnostic —
   * isolation is the database handle — but an event leaves the handle behind,
   * and a module activated per organization (ADR 0078 §4) cannot tell whose
   * books to post it to without it.
   */
  readonly organizationId: string;
  readonly offeringId: string;
  /** Signed: `+` in, `-` out. */
  readonly quantity: number;
  /** `receipt`, `sale`, `cancellation`, `return` or `adjustment`. */
  readonly reason: string;
  /** ISO-8601. When the goods moved. */
  readonly occurredAt: string;
  /**
   * The document that caused it: the movement itself for a manual entry, the
   * hold a sale converted, or the order whose goods went back.
   */
  readonly cause: { readonly type: string; readonly id: string };
}

export const StockMovementRecordSchema = openStruct({
  id: Schema.NonEmptyString,
  organizationId: Schema.NonEmptyString,
  offeringId: Schema.NonEmptyString,
  quantity: Schema.Finite,
  reason: Schema.NonEmptyString,
  occurredAt: Schema.NonEmptyString,
  cause: openStruct({
    type: Schema.NonEmptyString,
    id: Schema.NonEmptyString,
  }),
});

// A ledger line is written once and never changes, so it is its own aggregate
// at version 1: ordering per aggregate has nothing to order.
registerEvent(STOCK_MOVEMENT_RECORDED, StockMovementRecordSchema, {
  versioned: true,
  audience: 'none',
});

/**
 * A movement as a routable message from `source`, built member by member from
 * the entity rather than its serialized form, so whatever the entity gains
 * reaches no subscriber until it is named here.
 *
 * ⚠️ A movement written before its cause was recorded names itself: a manual
 * entry is its own document.
 */
export const stockMovementRecordedEvent = (
  organizationId: string,
  movement: StockMovement,
  source: string,
): DomainEvent<StockMovementRecord> & {
  aggregate: AggregateRef;
  version: number;
} => {
  const id = movement.id as string;
  const occurredAt = (movement.occurredAt ?? new Date()).toISOString();
  return {
    name: STOCK_MOVEMENT_RECORDED,
    id,
    source,
    at: occurredAt,
    correlationId: movement.offeringId,
    aggregate: { type: 'stock-movement', id },
    version: 1,
    data: {
      id,
      organizationId,
      offeringId: movement.offeringId,
      quantity: movement.quantity,
      reason: movement.reason,
      occurredAt,
      cause:
        movement.causeType === undefined || movement.causeId === ''
          ? { type: 'manual', id }
          : { type: movement.causeType, id: movement.causeId },
    },
  };
};
