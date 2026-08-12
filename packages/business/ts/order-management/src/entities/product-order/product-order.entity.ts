import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import type { OrderItem } from '../../values/order-item';
import { type OrderStatus, OrderStatuses } from '../../values/order-status';

/**
 * A party's request for one or more offerings — one checkout, one receipt, even
 * when the basket spans several vendors.
 *
 * The multi-vendor case is carried on the **items**, not by splitting the order:
 * each {@link OrderItem} names its `vendorId`, so settlement aggregates per
 * vendor while the buyer sees the single order they actually placed
 * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * Platform plane, `order` store — readable by the buyer, the vendors on its
 * lines and the operator, and by no tenant handle. That is also why the
 * reservation each line holds is taken through a service-to-service crossing
 * rather than from the session: a buyer's session carries no organization, and
 * the vendor comes from the item
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * The cart is **not** here. It is a cookie, so the storefront's first response is
 * correct without a round trip, and it becomes a `ProductOrder` only at checkout.
 */
@entity({
  domain: 'order-management',
  key: 'product-order',
  labelKey: 'entity:product-order.label',
  pluralKey: 'entity:product-order.plural',
})
export class ProductOrder implements Entity {
  // #region properties
  #id?: EntityId;
  #buyerId: string;
  #status: OrderStatus = 'pending';
  #items: readonly OrderItem[] = [];
  #placedAt?: Date;
  // #endregion

  // #region constructors
  constructor(buyerId = '') {
    this.#buyerId = buyerId;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:product-order.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** The `Party` that placed it. Filterable — "my orders" is the buyer's page. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.buyerId',
    required: true,
    filterable: true,
  })
  get buyerId(): string {
    return this.#buyerId;
  }
  set buyerId(value: string) {
    this.#buyerId = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.status',
    enumValues: OrderStatuses,
    enumLabelKey: 'entity:product-order.values.status',
    required: true,
    filterable: true,
  })
  get status(): OrderStatus {
    return this.#status;
  }
  set status(value: OrderStatus) {
    this.#status = value;
  }

  /**
   * An object array, so it falls outside the `MetaAccessorTypes` taxonomy — the
   * same situation as `Membership.roleIds`. Declared with sorting and filtering
   * **off**, because member metadata is also the server-side filter allowlist
   * and an embedded array compared as a scalar matches nothing.
   *
   * `hidden` would be the wrong tool here: it drops a member from serialization
   * *and* deserialization, so the lines would never persist.
   *
   * Vendor-scoped queries therefore need an index on the embedded path or a
   * projection — the accepted cost of one receipt per checkout.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.items',
    sortable: false,
    filterable: false,
  })
  get items(): readonly OrderItem[] {
    return this.#items;
  }
  set items(value: readonly OrderItem[]) {
    this.#items = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.placedAt',
    sortable: true,
    filterable: true,
  })
  get placedAt(): Date | undefined {
    return this.#placedAt;
  }
  set placedAt(value: Date | undefined) {
    this.#placedAt = value;
  }
  // #endregion
}
