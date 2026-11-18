import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import { CheckoutContact } from '../../values/checkout-contact';
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
  // An order is called by its number, never by a UUID: ADR 0076 §5.
  labelMember: 'number',
  // A checkout writes the group under its own flow id; nobody opens one.
  creatable: false,
})
export class CheckoutGroup implements Entity {
  // #region properties
  #id?: EntityId;
  #number = '';
  #buyerId?: string;
  #orderIds: readonly string[] = [];
  #totals: readonly GroupTotal[] = [];
  #placedAt?: Date;
  #cancelDigest?: string;
  #cancelWindowEndsAt?: Date;
  #receiptEndsAt?: Date;
  #accessDigest?: string;
  #accessExpiresAt?: Date;
  #accessSentAt?: Date;
  #contact: readonly CheckoutContact[] = [];
  #locale?: string;
  #redactedAt?: Date;
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
   * What a person reads out — eight Crockford characters, shown `7KQ4-M2XD`
   * (ADR 0076 §5). Drawn at random by the domain when the record is written,
   * unique in the store, which redraws on a collision. ⚠️ Server-owned and
   * writable anyway (`readonly` would drop it from serialization), and never a
   * credential: nothing is read or authorized by it.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.number',
    filterable: true,
    // Sortable so a search result group has an order to list it in.
    sortable: true,
  })
  get number(): string {
    return this.#number;
  }
  set number(value: string) {
    this.#number = value;
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
   * opening from {@link placedAt}. Always inside {@link receiptEndsAt}: the
   * cookie that carries the capability lives as long as the receipt does.
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

  /**
   * Until when the buyer's capability may still **read** the receipt — days
   * past the cancel window, because a parcel takes days and the receipt is how
   * the buyer follows it (ADR 0076 §6). Server-owned, stamped at opening from
   * {@link placedAt} and only for a group that carries a digest; the
   * storefront sizes the receipt cookie from it.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:checkout-group.fields.receiptEndsAt',
    sortable: true,
    filterable: true,
  })
  get receiptEndsAt(): Date | undefined {
    return this.#receiptEndsAt;
  }
  set receiptEndsAt(value: Date | undefined) {
    this.#receiptEndsAt = value;
  }

  /**
   * The SHA-256 digest of the one-time access link the buyer was last mailed,
   * until it is redeemed or expires — **the digest, never the token**, which
   * exists only in that email (ADR 0076 §6). Redeeming it replaces
   * {@link cancelDigest} and clears it, so one link opens the receipt once.
   *
   * ⚠️ `filterable` and `sortable` are written `false`, not omitted, for the
   * reason {@link cancelDigest} gives; `hidden` because no screen shows it.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.accessDigest',
    sortable: false,
    filterable: false,
  })
  get accessDigest(): string | undefined {
    return this.#accessDigest;
  }
  set accessDigest(value: string | undefined) {
    this.#accessDigest = value;
  }

  /** Until when {@link accessDigest} may be redeemed (`order.accessLinkHours`). */
  @accessor({
    type: 'date',
    labelKey: 'entity:checkout-group.fields.accessExpiresAt',
    sortable: false,
    filterable: false,
  })
  get accessExpiresAt(): Date | undefined {
    return this.#accessExpiresAt;
  }
  set accessExpiresAt(value: Date | undefined) {
    this.#accessExpiresAt = value;
  }

  /**
   * When the last access link went out. Kept past a redemption, because it is
   * what bounds a lookup to one mail per `order.accessLinkIntervalSeconds` —
   * the only rate limit on the one route a stranger can make send mail.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:checkout-group.fields.accessSentAt',
    sortable: false,
    filterable: false,
  })
  get accessSentAt(): Date | undefined {
    return this.#accessSentAt;
  }
  set accessSentAt(value: Date | undefined) {
    this.#accessSentAt = value;
  }
  /**
   * The buyer's contact and where the parcels go — **the platform's one record
   * of a storefront buyer** (ADR 0076 §1). At most one row: none at a counter,
   * and none once the retention sweep removed it. Read back by the buyer's
   * capability and by an operator; a vendor never reads a group, and it never
   * reaches the bus.
   *
   * ⚠️ `filterable` and `sortable` are written `false`, not omitted: a
   * queryable phone or email lets a caller confirm a guess one request at a
   * time.
   */
  @accessor({
    type: 'composition',
    childType: () => CheckoutContact,
    labelKey: 'entity:checkout-group.fields.contact',
    filterable: false,
    sortable: false,
  })
  get contact(): readonly CheckoutContact[] {
    return this.#contact;
  }
  set contact(value: readonly CheckoutContact[]) {
    this.#contact = value;
  }

  /** The locale the buyer checked out in, which their mail is written in. */
  @accessor({
    type: 'string',
    labelKey: 'entity:checkout-group.fields.locale',
    filterable: false,
    sortable: false,
  })
  get locale(): string | undefined {
    return this.#locale;
  }
  set locale(value: string | undefined) {
    this.#locale = value;
  }

  /**
   * When the retention sweep removed {@link contact}, so a screen can say the
   * details were removed rather than render a field that was never asked.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:checkout-group.fields.redactedAt',
  })
  get redactedAt(): Date | undefined {
    return this.#redactedAt;
  }
  set redactedAt(value: Date | undefined) {
    this.#redactedAt = value;
  }
  // #endregion
}
