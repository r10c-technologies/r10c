import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  type OrderTender,
  OrderTenders,
} from '@r10c/business-ts-sales-vocabulary';
import {
  type BuyerTaxIdType,
  BuyerTaxIdTypes,
  type TaxRegime,
  TaxRegimes,
} from '@r10c/business-ts-tax-policy';

import { OrderItem } from '../../values/order-item';
import {
  type OrderStatus,
  OrderStatuses,
  OrderStatusTones,
} from '../../values/order-status';
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
  // An order is called by its number, never by a UUID: ADR 0076 §5.
  labelMember: 'number',
  // Only a checkout writes an order per ADR 0069, so no list offers "New".
  creatable: false,
})
export class ProductOrder implements Entity {
  // #region properties
  #id?: EntityId;
  #number = '';
  #buyerId?: string;
  #vendorId = '';
  #groupId = '';
  #paymentMethod: OrderTender = 'card';
  #channel?: RelatedChannel;
  #status: OrderStatus = 'pending';
  #items: readonly OrderItem[] = [];
  #placedAt?: Date;
  #paidAt?: Date;
  #sellerTaxId = '';
  #sellerLegalName = '';
  #sellerTaxRegime: TaxRegime = 'general';
  #sellerEstablishmentCode = '';
  #buyerTaxIdType: BuyerTaxIdType = 'cf';
  #buyerTaxId = '';
  #buyerTaxName = '';
  #netAmount = 0;
  #taxAmount = 0;
  #totalAmount = 0;
  #currency = '';
  #paymentDueAt?: Date;
  #paymentReference?: string;
  #paymentConfirmedBy?: string;
  #paymentConfirmedAt?: Date;
  #paymentLinkUrl?: string;
  #paymentLinkProviderKey?: string;
  #paymentLinkProviderName?: string;
  #paymentLinkSetBy?: string;
  #paymentLinkSetAt?: Date;
  #cancelCause?: string;
  #courierName?: string;
  #trackingNumber?: string;
  #trackingUrl?: string;
  #dispatchedAt?: Date;
  #fulfilledAt?: Date;
  // #endregion

  // #region constructors
  constructor(buyerId?: string) {
    this.#buyerId = buyerId;
  }
  // #endregion

  // #region accessors
  // `filterable` because a reference names this record by `id=in=(…)`
  // (entifix 0030): member metadata is the server-side query allowlist.
  @accessor({ labelKey: 'entity:product-order.fields.id', filterable: true })
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
    labelKey: 'entity:product-order.fields.number',
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
  //
  // A reference, because that is what it holds: the buyer's party id, from
  // another store. Declared, it is never taken for the order's name — an
  // order names itself, noun and short id, until ADR 0076's number (#552).
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.buyerId',
    filterable: true,
    references: { entity: 'party-management:individual' },
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
    references: { entity: 'marketplace-vendor:published-vendor' },
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
    references: { entity: 'order-management:checkout-group' },
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
    enumTones: OrderStatusTones,
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
  /** The seller's NIT, copied from the published vendor at placement and never updated (ADR 0078 §6). */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.sellerTaxId',
    filterable: false,
  })
  get sellerTaxId(): string {
    return this.#sellerTaxId;
  }
  set sellerTaxId(value: string) {
    this.#sellerTaxId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.sellerLegalName',
    filterable: false,
  })
  get sellerLegalName(): string {
    return this.#sellerLegalName;
  }
  set sellerLegalName(value: string) {
    this.#sellerLegalName = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.sellerTaxRegime',
    enumValues: [...TaxRegimes],
    enumLabelKey: 'entity:organization.values.taxRegime',
    filterable: false,
  })
  get sellerTaxRegime(): TaxRegime {
    return this.#sellerTaxRegime;
  }
  set sellerTaxRegime(value: TaxRegime) {
    this.#sellerTaxRegime = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.sellerEstablishmentCode',
    filterable: false,
  })
  get sellerEstablishmentCode(): string {
    return this.#sellerEstablishmentCode;
  }
  set sellerEstablishmentCode(value: string) {
    this.#sellerEstablishmentCode = value;
  }

  /** How the buyer is documented: a NIT, a CUI or consumidor final. Personal data: stored here and never put on an `order.*` event (ADR 0078 §2). */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.buyerTaxIdType',
    enumValues: [...BuyerTaxIdTypes],
    enumLabelKey: 'entity:product-order.values.buyerTaxIdType',
    filterable: false,
  })
  get buyerTaxIdType(): BuyerTaxIdType {
    return this.#buyerTaxIdType;
  }
  set buyerTaxIdType(value: BuyerTaxIdType) {
    this.#buyerTaxIdType = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.buyerTaxId',
    filterable: false,
  })
  get buyerTaxId(): string {
    return this.#buyerTaxId;
  }
  set buyerTaxId(value: string) {
    this.#buyerTaxId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.buyerTaxName',
    filterable: false,
  })
  get buyerTaxName(): string {
    return this.#buyerTaxName;
  }
  set buyerTaxName(value: string) {
    this.#buyerTaxName = value;
  }

  /** The document's taxable base, its tax and its total, stated by the coordinator from `taxDocument` and stored as told. */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.netAmount',
    money: { unit: 'minor', currencyMember: 'currency' },
    filterable: false,
  })
  get netAmount(): number {
    return this.#netAmount;
  }
  set netAmount(value: number) {
    this.#netAmount = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.taxAmount',
    money: { unit: 'minor', currencyMember: 'currency' },
    filterable: false,
  })
  get taxAmount(): number {
    return this.#taxAmount;
  }
  set taxAmount(value: number) {
    this.#taxAmount = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.totalAmount',
    money: { unit: 'minor', currencyMember: 'currency' },
    filterable: false,
  })
  get totalAmount(): number {
    return this.#totalAmount;
  }
  set totalAmount(value: number) {
    this.#totalAmount = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.currency',
    filterable: false,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  /**
   * When a payment-link order stops waiting: its checkout's commit point plus
   * the payment window the coordinator stated. Past it the expiry sweep cancels
   * the order, unless the seller confirmed first (ADR 0081 §3–4). Server-owned,
   * and writable anyway, as {@link paidAt} is.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.paymentDueAt',
    sortable: true,
    filterable: true,
  })
  get paymentDueAt(): Date | undefined {
    return this.#paymentDueAt;
  }
  set paymentDueAt(value: Date | undefined) {
    this.#paymentDueAt = value;
  }

  /**
   * The authorization number the seller confirmed a payment link with — the
   * record that money moved at their acquirer, kept after any receipt image is
   * deleted (ADR 0081 §4, §9).
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.paymentReference',
    filterable: true,
  })
  get paymentReference(): string | undefined {
    return this.#paymentReference;
  }
  set paymentReference(value: string | undefined) {
    this.#paymentReference = value;
  }

  /**
   * Who confirmed the payment: the user id of the seller's staff member.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.paymentConfirmedBy',
    references: { entity: 'party-management:individual' },
  })
  get paymentConfirmedBy(): string | undefined {
    return this.#paymentConfirmedBy;
  }
  set paymentConfirmedBy(value: string | undefined) {
    this.#paymentConfirmedBy = value;
  }

  /**
   * When the seller confirmed the payment.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.paymentConfirmedAt',
    sortable: true,
  })
  get paymentConfirmedAt(): Date | undefined {
    return this.#paymentConfirmedAt;
  }
  set paymentConfirmedAt(value: Date | undefined) {
    this.#paymentConfirmedAt = value;
  }

  /**
   * The payment link the seller pasted, `https` only; the last one set wins
   * (ADR 0081 §10). Not personal data, and never on the bus.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.paymentLinkUrl',
  })
  get paymentLinkUrl(): string | undefined {
    return this.#paymentLinkUrl;
  }
  set paymentLinkUrl(value: string | undefined) {
    this.#paymentLinkUrl = value;
  }

  /**
   * Which link provider the URL is from, as a dictionary key — `other` when
   * the seller named none of the configured ones.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.paymentLinkProviderKey',
  })
  get paymentLinkProviderKey(): string | undefined {
    return this.#paymentLinkProviderKey;
  }
  set paymentLinkProviderKey(value: string | undefined) {
    this.#paymentLinkProviderKey = value;
  }

  /**
   * The provider's display name, copied when the link was set: a dictionary
   * edit changes no past order (ADR 0081 §10).
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.paymentLinkProviderName',
  })
  get paymentLinkProviderName(): string | undefined {
    return this.#paymentLinkProviderName;
  }
  set paymentLinkProviderName(value: string | undefined) {
    this.#paymentLinkProviderName = value;
  }

  /**
   * Who set the link: the user id of the seller's staff member.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.paymentLinkSetBy',
    references: { entity: 'party-management:individual' },
  })
  get paymentLinkSetBy(): string | undefined {
    return this.#paymentLinkSetBy;
  }
  set paymentLinkSetBy(value: string | undefined) {
    this.#paymentLinkSetBy = value;
  }

  /**
   * When the link was last set.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.paymentLinkSetAt',
  })
  get paymentLinkSetAt(): Date | undefined {
    return this.#paymentLinkSetAt;
  }
  set paymentLinkSetAt(value: Date | undefined) {
    this.#paymentLinkSetAt = value;
  }

  /**
   * Why an order waiting on its payment was cancelled: `payment-expired` when
   * its window lapsed, `buyer` when the buyer withdrew it (ADR 0081 §4).
   * Absent for every other cancellation, which a flow records.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.cancelCause',
    filterable: true,
  })
  get cancelCause(): string | undefined {
    return this.#cancelCause;
  }
  set cancelCause(value: string | undefined) {
    this.#cancelCause = value;
  }
  /** The courier the parcel left with, copied from the shipment by the delivery flow (ADR 0081 §11): the buyer reads order-service and never a vendor's fulfilment store. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.courierName',
  })
  get courierName(): string | undefined {
    return this.#courierName;
  }
  set courierName(value: string | undefined) {
    this.#courierName = value;
  }

  /** The parcel's guide number, copied from the shipment at dispatch. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.trackingNumber',
  })
  get trackingNumber(): string | undefined {
    return this.#trackingNumber;
  }
  set trackingNumber(value: string | undefined) {
    this.#trackingNumber = value;
  }

  /** Where the buyer follows the parcel, copied from the shipment at dispatch. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.trackingUrl',
  })
  get trackingUrl(): string | undefined {
    return this.#trackingUrl;
  }
  set trackingUrl(value: string | undefined) {
    this.#trackingUrl = value;
  }
  /** When the parcel left with a courier, or the goods were handed over at a counter. Server-owned and writable anyway: `readonly` would drop it from deserialization too. */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.dispatchedAt',
    sortable: true,
    filterable: true,
  })
  get dispatchedAt(): Date | undefined {
    return this.#dispatchedAt;
  }
  set dispatchedAt(value: Date | undefined) {
    this.#dispatchedAt = value;
  }

  /** When the order reached its buyer. Server-owned and writable anyway, as the other stamps are. */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.fulfilledAt',
    sortable: true,
    filterable: true,
  })
  get fulfilledAt(): Date | undefined {
    return this.#fulfilledAt;
  }
  set fulfilledAt(value: Date | undefined) {
    this.#fulfilledAt = value;
  }
  // #endregion
}
