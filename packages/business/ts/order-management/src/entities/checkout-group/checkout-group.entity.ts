import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import { GroupTotal } from '../../values/group-total';

/**
 * One checkout: the buyer's receipt across every seller in the basket, holding
 * the vendor orders it was split into and the capability that cancels them.
 *
 * A checkout writes one of these and then one {@link ProductOrder} per vendor,
 * each naming this group; the group is what the buyer sees and what a capture
 * is charged against, and an order is what each vendor reads, ships and
 * cancels ([ADR 0069](../../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md)).
 *
 * ⚠️ **Its id is the checkout flow's id.** The flow opens the group under the
 * id it was started with, so a storefront that knows only the flow it is
 * waiting on can find the receipt it produced, with no session to look it up
 * by.
 *
 * Platform plane, `order` store, beside its orders. Readable by the buyer who
 * placed it and the operator — **never by a vendor**, who would see the other
 * sellers in the basket.
 */
@entity({
  domain: 'order-management',
  key: 'checkout-group',
  labelKey: 'entity:checkout-group.label',
  pluralKey: 'entity:checkout-group.plural',
  // A checkout writes the group under its own flow id; nobody opens one.
  creatable: false,
})
export class CheckoutGroup implements Entity {
  // #region properties
  #id?: EntityId;
  #buyerId?: string;
  #orderIds: readonly string[] = [];
  #totals: readonly GroupTotal[] = [];
  #placedAt?: Date;
  #cancelDigest?: string;
  #cancelWindowEndsAt?: Date;
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:checkout-group.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The `Party` that placed it, when they signed in. Optional for the reason
   * `ProductOrder.buyerId` is: a walk-in at a counter has no account.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.buyerId',
    filterable: true,
  })
  get buyerId(): string | undefined {
    return this.#buyerId;
  }
  set buyerId(value: string | undefined) {
    this.#buyerId = value;
  }

  /**
   * The vendor orders placed in it. ⚠️ **Server-owned and writable anyway**:
   * each order's write adds itself here with an atomic `$addToSet` in the same
   * unit, and `readonly` would drop the member from deserialization too. An
   * order the checkout compensated away is not taken out — the group is
   * deleted by the very next compensation.
   */
  @accessor({
    type: 'scalarCollection',
    labelKey: 'entity:checkout-group.fields.orderIds',
  })
  get orderIds(): readonly string[] {
    return this.#orderIds;
  }
  set orderIds(value: readonly string[]) {
    this.#orderIds = value;
  }

  /** What the basket comes to, one total per currency. */
  @accessor({
    type: 'composition',
    childType: () => GroupTotal,
    labelKey: 'entity:checkout-group.fields.totals',
  })
  get totals(): readonly GroupTotal[] {
    return this.#totals;
  }
  set totals(value: readonly GroupTotal[]) {
    this.#totals = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:checkout-group.fields.placedAt',
    sortable: true,
    filterable: true,
  })
  get placedAt(): Date | undefined {
    return this.#placedAt;
  }
  set placedAt(value: Date | undefined) {
    this.#placedAt = value;
  }

  /**
   * The SHA-256 digest of the nonce that authorizes the buyer's own cancel and
   * their receipt read — **the digest, never the nonce**, which lives only in
   * the buyer's `httpOnly` receipt cookie, so nothing stored can perform what it
   * authorizes ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
   *
   * ⚠️ `filterable` and `sortable` are written `false`, not omitted: both
   * default to true for a scalar, and a queryable digest lets a caller confirm
   * a guess one request at a time. Absent on a counter sale, which has no
   * browser to hold the nonce.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.cancelDigest',
    sortable: false,
    filterable: false,
  })
  get cancelDigest(): string | undefined {
    return this.#cancelDigest;
  }
  set cancelDigest(value: string | undefined) {
    this.#cancelDigest = value;
  }

  /**
   * When the buyer's own cancel stops being possible. Server-owned, stamped at
   * opening from {@link placedAt}, and matched to the receipt cookie's own
   * lifetime: a window wider than the cookie is a capability nobody can
   * present.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:checkout-group.fields.cancelWindowEndsAt',
    sortable: true,
    filterable: true,
  })
  get cancelWindowEndsAt(): Date | undefined {
    return this.#cancelWindowEndsAt;
  }
  set cancelWindowEndsAt(value: Date | undefined) {
    this.#cancelWindowEndsAt = value;
  }
  // #endregion
}
