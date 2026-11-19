import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import {
  type MovementCauseType,
  MovementCauseTypes,
} from '../../values/movement-cause';
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
 * `occurredAt` and the cause (`causeType` + `causeId`) are server-owned: the
 * use case that writes a movement states them, whatever a caller sent, so a
 * ledger line can be dated and joined to the hold or the order behind it
 * (ADR 0078 §6). Writable rather than `readonly`, since a readonly member is
 * dropped from serialization both ways.
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
  #occurredAt?: Date;
  #causeType?: MovementCauseType;
  #causeId = '';
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

  // `sortable` as well as `filterable`, and not for the table's sake: this
  // metadata is simultaneously the server-side allowlist, and it is the only
  // member of these entities that can name one of their records — a search
  // source refuses a label member that is not sortable, at module load.
  @accessor({
    references: { entity: 'product-configuration-management:product-offering' },
    type: 'string',
    labelKey: 'entity:stock-movement.fields.offeringId',
    required: true,
    filterable: true,
    sortable: true,
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

  @accessor({
    type: 'date',
    labelKey: 'entity:stock-movement.fields.occurredAt',
    sortable: true,
    filterable: true,
  })
  get occurredAt(): Date | undefined {
    return this.#occurredAt;
  }
  set occurredAt(value: Date | undefined) {
    this.#occurredAt = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:stock-movement.fields.causeType',
    enumValues: MovementCauseTypes,
    enumLabelKey: 'entity:stock-movement.values.causeType',
    filterable: true,
  })
  get causeType(): MovementCauseType | undefined {
    return this.#causeType;
  }
  set causeType(value: MovementCauseType | undefined) {
    this.#causeType = value;
  }

  /** The movement's own id, the hold's, or the order's — by {@link causeType}. */
  @accessor({
    type: 'string',
    labelKey: 'entity:stock-movement.fields.causeId',
    filterable: true,
  })
  get causeId(): string {
    return this.#causeId;
  }
  set causeId(value: string) {
    this.#causeId = value;
  }
  // #endregion
}
