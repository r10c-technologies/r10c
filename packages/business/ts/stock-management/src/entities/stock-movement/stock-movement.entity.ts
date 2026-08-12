import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type MovementReason,
  MovementReasons,
} from '../../values/movement-reason';

/**
 * One append-only record of a quantity change: `+50` on a receipt, `-1` on a
 * sale, `+1` on a cancellation.
 *
 * This is the system of record for stock; {@link StockItem} is its running
 * total. Append-only is not bookkeeping fastidiousness — it is what makes the
 * total reconstructible after a bad write, what gives every change a reason
 * without a separate audit table, and what lets a shipment become a movement
 * type rather than a second inventory model.
 *
 * `quantity` is **signed**, so a movement is one field rather than a quantity
 * plus a direction that can disagree with its {@link reason}.
 *
 * Tenant plane, `stock` store.
 */
@entity({
  domain: 'stock-management',
  key: 'stock-movement',
  labelKey: 'entity:stock-movement.label',
  pluralKey: 'entity:stock-movement.plural',
})
export class StockMovement implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  #quantity: number;
  #reason: MovementReason;
  // #endregion

  // #region constructors
  constructor(
    offeringId = '',
    quantity = 0,
    reason: MovementReason = 'adjustment',
  ) {
    this.#offeringId = offeringId;
    this.#quantity = quantity;
    this.#reason = reason;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:stock-movement.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:stock-movement.fields.offeringId',
    required: true,
    filterable: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  /** Signed: negative removes, positive adds. */
  @accessor({
    type: 'number',
    labelKey: 'entity:stock-movement.fields.quantity',
    required: true,
    sortable: true,
    filterable: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:stock-movement.fields.reason',
    enumValues: MovementReasons,
    enumLabelKey: 'entity:stock-movement.values.reason',
    required: true,
    filterable: true,
  })
  get reason(): MovementReason {
    return this.#reason;
  }
  set reason(value: MovementReason) {
    this.#reason = value;
  }
  // #endregion
}
