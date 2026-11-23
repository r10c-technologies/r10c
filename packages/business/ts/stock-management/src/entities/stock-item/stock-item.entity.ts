import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  SALE_UNIT_NAME_KEY,
  SALE_UNIT_SCALES,
  SALE_UNIT_SYMBOL_KEY,
  type SaleUnit,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';

/**
 * The running availability of one offering for one vendor: what is physically
 * held, and how much of it is already promised.
 *
 * It is a **materialized total**, not the source of truth — {@link StockMovement}
 * is the ledger, and this is its fold. Keeping both is what makes audit and
 * reconciliation free instead of a feature.
 *
 * The two counters are separate on purpose. A vendor receiving goods moves
 * `onHand`; a buyer checking out moves `reserved`. Different fields, both
 * written with atomic in-place operators (`$inc`), so the two are
 * order-independent and there is no race to resolve. Availability,
 * `onHand - reserved`, is stored as `available` and moved **in the same
 * update** as whichever counter moved, so the three can never disagree and a
 * list can sort and filter on the number a vendor sells from (#555).
 *
 * Neither counter is ever read-modify-written. An absolute-value write loses
 * updates between two requests inside a single process, long before any
 * distributed concern arises
 * ([ADR 0010](../../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * Tenant plane, in the `stock` store — deliberately not the `catalog` store,
 * because a quantity is owned by stock-management and a product definition by
 * product-configuration-management, and one record written by two domains is
 * the coupling the decomposition exists to prevent.
 */
@entity({
  labelMember: 'offeringId',
  domain: 'stock-management',
  key: 'stock-item',
  labelKey: 'entity:stock-item.label',
  pluralKey: 'entity:stock-item.plural',
  // An item's counters move only through movements and holds per ADR 0010.
  creatable: false,
})
export class StockItem implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  // No default: a unit nobody stated is absent, never `UN` (ADR 0082 §4).
  #unit?: SaleUnit;
  #onHand = 0;
  #reserved = 0;
  #available = 0;
  // #endregion

  // #region constructors
  constructor(offeringId = '') {
    this.#offeringId = offeringId;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:stock-item.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The offering this stock is for. A plain id rather than a `link`: the target
   * lives in another store, and a link would invite the storage-layer join that
   * the one-writer rule forbids.
   */
  // `sortable` as well as `filterable`, and not for the table's sake: this
  // metadata is simultaneously the server-side allowlist, and it is the only
  // member of these entities that can name one of their records — a search
  // source refuses a label member that is not sortable, at module load.
  @accessor({
    references: { entity: 'product-configuration-management:product-offering' },
    type: 'string',
    labelKey: 'entity:stock-item.fields.offeringId',
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

  /**
   * What every counter here is counted in (ADR 0082 §4). The first movement
   * fixes it, and a movement or a hold in another unit is refused
   * `unitMismatch` rather than added to the total. The counters are neither
   * sortable nor filterable across items, since 3500 means 3.5 m on one row and
   * 3,500 pieces on the next — except `available`, whose zero means the same in
   * every unit.
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:stock-item.fields.unit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
    required: true,
    filterable: true,
  })
  get unit(): SaleUnit | undefined {
    return this.#unit;
  }
  set unit(value: SaleUnit | undefined) {
    this.#unit = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:stock-item.fields.onHand',
    required: true,
    // In the unit's scale: compared across rows it compares metres with pieces.
    sortable: false,
    filterable: false,
    scaled: {
      unitMember: 'unit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get onHand(): number {
    return this.#onHand;
  }
  set onHand(value: number) {
    this.#onHand = value;
  }

  /**
   * Held by live reservations. The guard a checkout writes,
   * `onHand - reserved >= qty`, is the store's conditional write, never a
   * query, so neither counter needs to be filterable.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:stock-item.fields.reserved',
    required: true,
    // In the unit's scale: compared across rows it compares metres with pieces.
    sortable: false,
    filterable: false,
    scaled: {
      unitMember: 'unit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get reserved(): number {
    return this.#reserved;
  }
  set reserved(value: number) {
    this.#reserved = value;
  }

  /**
   * What can still be sold: `onHand - reserved`, moved by the same atomic
   * update that moves either counter. Sortable so a list can put what is out
   * on top; filterable so "what am I out of?" is one query.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:stock-item.fields.available',
    sortable: true,
    filterable: true,
    scaled: {
      unitMember: 'unit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get available(): number {
    return this.#available;
  }
  set available(value: number) {
    this.#available = value;
  }
  // #endregion
}
