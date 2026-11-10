import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  type OrderTender,
  OrderTenders,
} from '@r10c/business-ts-sales-vocabulary';

import { OrderItem } from '../../values/order-item';
import { type OrderStatus, OrderStatuses } from '../../values/order-status';
import type { RelatedChannel } from '../../values/related-channel';

/**
 * One vendor's part of a checkout: the lines that vendor owes, how the buyer
 * pays for them, and where that one order stands.
 *
 * ⚠️ **One order per vendor, under a {@link CheckoutGroup}.** A basket spanning
 * three sellers is three of these, each naming its {@link vendorId} and its
 * {@link groupId}; the buyer's one receipt is the group. Each vendor reads,
 * ships, cancels and is refunded for their own order alone, which is what one
 * multi-vendor order could never let them do
 * ([ADR 0069](../../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md)).
 *
 * Platform plane, `order` store — readable by the buyer, the vendor it belongs
 * to and the operator, and by no tenant handle. That is also why the
 * reservation each line holds is taken through a service-to-service crossing
 * rather than from the session: a buyer's session carries no organization, and
 * the vendor comes from the order
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * The cart is **not** here. It is a cookie, so the storefront's first response is
 * correct without a round trip, and it becomes a group of these only at checkout.
 *
 * **A storefront checkout is not the only way one of these is born.** A vendor
 * selling at their own counter produces this same entity with a different
 * {@link channel} — TM Forum models an in-store sale as a channel on the order
 * rather than a second kind of order, and following that is what keeps
 * settlement, returns and the buyer's history from splitting in two
 * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 * The counter case is also why {@link buyerId} is optional.
 */
@entity({
  domain: 'order-management',
  key: 'product-order',
  labelKey: 'entity:product-order.label',
  pluralKey: 'entity:product-order.plural',
  // Only a checkout writes an order per ADR 0069, so no list offers "New".
  creatable: false,
})
export class ProductOrder implements Entity {
  // #region properties
  #id?: EntityId;
  #buyerId?: string;
  #vendorId = '';
  #groupId = '';
  #paymentMethod: OrderTender = 'card';
  #channel?: RelatedChannel;
  #status: OrderStatus = 'pending';
  #items: readonly OrderItem[] = [];
  #placedAt?: Date;
  #paidAt?: Date;
  // #endregion

  // #region constructors
  constructor(buyerId?: string) {
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

  /**
   * The `Party` that placed it. Filterable — "my orders" is the buyer's page.
   *
   * **Optional, and that is a decision rather than laxity.** A walk-in buying at
   * a vendor's counter has no account, and demanding one at the register is
   * friction that gets worked around by inventing junk parties — which is worse
   * than an honest absence. {@link channel} is what explains the gap: an order
   * with no buyer came through a channel where anonymity is normal.
   *
   * The cost, stated so it is not rediscovered: a buyer's order list simply does
   * not match these, and attaching a party to a past counter sale — for a return
   * or a loyalty scheme — is a backfill, not a lookup
   * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.buyerId',
    filterable: true,
  })
  get buyerId(): string | undefined {
    return this.#buyerId;
  }
  set buyerId(value: string | undefined) {
    this.#buyerId = value;
  }

  /**
   * The one vendor this order belongs to. Filterable and sortable: a vendor's
   * order list is a top-level filter on it, and the server narrows every vendor
   * read to their own organization here.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.vendorId',
    required: true,
    filterable: true,
    sortable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  /**
   * The checkout group this order was placed in — the buyer's one receipt
   * across sellers. A plain id: the group lives in this same store, but an
   * order is read and moved on its own.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.groupId',
    required: true,
    filterable: true,
  })
  get groupId(): string {
    return this.#groupId;
  }
  set groupId(value: string) {
    this.#groupId = value;
  }

  /**
   * How the buyer pays this vendor: a card captured at checkout, cash at the
   * counter, or cash on delivery — chosen per seller, so two orders in one
   * group may differ (ADR 0070).
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.paymentMethod',
    enumValues: OrderTenders,
    enumLabelKey: 'entity:product-order.values.paymentMethod',
    required: true,
    filterable: true,
  })
  get paymentMethod(): OrderTender {
    return this.#paymentMethod;
  }
  set paymentMethod(value: OrderTender) {
    this.#paymentMethod = value;
  }

  /**
   * Where the sale came from — the storefront, a vendor's counter, a phone line.
   *
   * TM Forum's answer to in-store selling, and the reason this class did not
   * need a sibling: TMF622 carries a `RelatedChannel` on the order rather than
   * forking by origin, so a counter sale is *this* entity with a different
   * channel. Building a separate in-store order would have split settlement,
   * returns and the buyer's history in two for no gain.
   *
   * A denormalized copy rather than a link, because a `SalesChannel` lives in
   * another slice's tenant store and this order is platform plane — see
   * {@link RelatedChannel}.
   *
   * Optional: orders captured before channels existed have none, and the
   * storefront may leave it unset when there is only one place a sale could have
   * come from. Absent is read as the storefront.
   *
   * Not filterable, for the same reason {@link items} is not — member metadata
   * is the server-side allowlist, and an embedded object compared as a scalar
   * matches nothing. Selecting orders by channel needs an index on the embedded
   * path.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.channel',
    sortable: false,
    filterable: false,
  })
  get channel(): RelatedChannel | undefined {
    return this.#channel;
  }
  set channel(value: RelatedChannel | undefined) {
    this.#channel = value;
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
   * The lines. A **`composition`**: they are owned by this order, have no life
   * outside it, and go out in the same write
   * ([ADR 0034](../../../../../../docs/adr/0034-composition-metadata.md)).
   *
   * Not a `linkCollection`, which is association — targets that exist on their
   * own, are picked from existing records and save separately. An order line is
   * never picked and never outlives its receipt.
   *
   * `childType` is what a detail grid reads its columns from: `OrderItem`'s own
   * `@accessor()` metadata. A thunk, so the two modules' evaluation order stays
   * irrelevant.
   *
   * Sorting and filtering are off by construction — `describeEntityColumns`
   * defaults every collection to unqueryable and **throws** on a declaration
   * that says otherwise — because member metadata is the server-side query
   * allowlist and an embedded array compared as a scalar matches nothing.
   *
   * `hidden` would be the wrong tool here: it drops a member from serialization
   * *and* deserialization, so the lines would never persist.
   */
  @accessor({
    type: 'composition',
    childType: () => OrderItem,
    labelKey: 'entity:product-order.fields.items',
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

  /**
   * When the capture that paid for this order was decided.
   *
   * ⚠️ **Server-owned, and writable anyway.** The payment projection sets it
   * from `payment.captured`'s own `decidedAt` in the same conditional update
   * that moves `status` to `paid`, and no route accepts it from a caller.
   * Declaring it `readonly` would drop it from **deserialization** as well as
   * serialization, so the value would never reach a screen either — the same
   * trap a read-only audit stamp always is.
   *
   * It existed in Mongo before it existed here: the projection wrote the field
   * and this entity declared no accessor for it, so it reached no envelope, no
   * column and no form (#249). A member without a getter is invisible to every
   * adapter, which is why the write looked correct and changed nothing anybody
   * could see.
   *
   * Sortable and filterable because "what did we take money for this week" is
   * the question a vendor's statement is reconciled against, and member
   * metadata is the server-side query allowlist.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.paidAt',
    sortable: true,
    filterable: true,
  })
  get paidAt(): Date | undefined {
    return this.#paidAt;
  }
  set paidAt(value: Date | undefined) {
    this.#paidAt = value;
  }
  // #endregion
}
