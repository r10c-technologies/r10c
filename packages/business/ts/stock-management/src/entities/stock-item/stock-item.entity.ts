import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

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
 * order-independent and there is no race to resolve. Availability is
 * `onHand - reserved`, computed and never stored — a third counter would be a
 * third thing to keep consistent.
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
  domain: 'stock-management',
  key: 'stock-item',
  labelKey: 'entity:stock-item.label',
  pluralKey: 'entity:stock-item.plural',
})
export class StockItem implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  #onHand = 0;
  #reserved = 0;
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
  @accessor({
    type: 'string',
    labelKey: 'entity:stock-item.fields.offeringId',
    required: true,
    filterable: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:stock-item.fields.onHand',
    required: true,
    sortable: true,
    filterable: true,
  })
  get onHand(): number {
    return this.#onHand;
  }
  set onHand(value: number) {
    this.#onHand = value;
  }

  /**
   * Held by live reservations. Filterable because the guard a checkout writes is
   * `onHand - reserved >= qty`, and that predicate is expressed over both.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:stock-item.fields.reserved',
    required: true,
    sortable: true,
    filterable: true,
  })
  get reserved(): number {
    return this.#reserved;
  }
  set reserved(value: number) {
    this.#reserved = value;
  }
  // #endregion
}
