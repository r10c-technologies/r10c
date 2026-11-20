import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  type OrderTender,
  OrderTenders,
} from '@r10c/business-ts-sales-vocabulary';

import { ShipmentDestination } from '../../values/shipment-destination';
import { ShippingLine } from '../../values/shipping-line';
import {
  type ShippingStatus,
  ShippingStatuses,
  ShippingStatusTones,
} from '../../values/shipping-status';

/**
 * One vendor order's journey from the vendor's shelf to the buyer's door —
 * TMF700's Shipping Order.
 *
 * Tenant plane, `fulfilment` store, `fulfilment_<organizationId>`: a shipment is
 * the vendor's work, readable by the vendor alone. It carries **no
 * `organizationId` member** — isolation is the database handle the request
 * resolves to, so no query can leak by omission.
 *
 * Opened by the delivery flow once the checkout commits, moved by that flow
 * (`hold`, `release`, `withdraw`, the `dispatch` pivot) and by the vendor
 * recording what the courier reports. Every move is one conditional write on
 * {@link status}, which is also what serializes a dispatch against a cancel
 * ([ADR 0070](../../../../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 */
@entity({
  // Named by its order's number, which it carries, so no read crosses stores.
  labelMember: 'orderNumber',
  domain: 'shipping-order-management',
  key: 'shipping-order',
  labelKey: 'entity:shipping-order.label',
  pluralKey: 'entity:shipping-order.plural',
  // A checkout opens the shipment per ADR 0070; a vendor only moves it.
  creatable: false,
})
export class ShippingOrder implements Entity {
  // #region properties
  #id?: EntityId;
  #orderId = '';
  #orderNumber = '';
  #destination: readonly ShipmentDestination[] = [];
  #redactedAt?: Date;
  #groupId = '';
  #flowId?: string;
  #paymentMethod: OrderTender = 'card';
  #amountDue = 0;
  #taxableBase = 0;
  #taxAmount = 0;
  #taxRegime = '';
  #currency = '';
  #lines: readonly ShippingLine[] = [];
  #status: ShippingStatus = 'awaiting-dispatch';
  #dispatchedAt?: Date;
  #deliveredAt?: Date;
  #refusedAt?: Date;
  #returnedAt?: Date;
  #withdrawnAt?: Date;
  #courierKey?: string;
  #courierName?: string;
  #trackingNumber?: string;
  #trackingUrl?: string;
  #guideRecordedAt?: Date;
  // #endregion

  // #region accessors
  @accessor({
    labelKey: 'entity:shipping-order.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** The vendor order this ships. An id, never a link: the order lives in the platform plane. */
  @accessor({
    references: { entity: 'order-management:product-order' },
    type: 'string',
    labelKey: 'entity:shipping-order.fields.orderId',
    required: true,
    filterable: true,
  })
  get orderId(): string {
    return this.#orderId;
  }
  set orderId(value: string) {
    this.#orderId = value;
  }

  /**
   * The vendor order's number, as the buyer's receipt shows it — what a vendor
   * reads out to a buyer and what labels the shipment (ADR 0076 §3, §5).
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.orderNumber',
    // What a row is read as, and the column held in view (#557).
    card: 'title',
    filterable: true,
    sortable: true,
  })
  get orderNumber(): string {
    return this.#orderNumber;
  }
  set orderNumber(value: string) {
    this.#orderNumber = value;
  }

  /**
   * Who receives the parcel and where — one row, copied from the buyer's
   * contact less the email (ADR 0076 §1). Removed by the retention sweep once
   * the parcel's journey ends; never on the bus.
   *
   * ⚠️ `filterable` and `sortable` are written `false`: a queryable phone lets
   * a caller confirm a guess one request at a time.
   */
  @accessor({
    type: 'composition',
    childType: () => ShipmentDestination,
    labelKey: 'entity:shipping-order.fields.destination',
    filterable: false,
    sortable: false,
  })
  get destination(): readonly ShipmentDestination[] {
    return this.#destination;
  }
  set destination(value: readonly ShipmentDestination[]) {
    this.#destination = value;
  }

  /** When the retention sweep removed {@link destination}. */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.redactedAt',
  })
  get redactedAt(): Date | undefined {
    return this.#redactedAt;
  }
  set redactedAt(value: Date | undefined) {
    this.#redactedAt = value;
  }

  /** The checkout group the order belongs to. */
  @accessor({
    references: { entity: 'order-management:checkout-group' },
    type: 'string',
    labelKey: 'entity:shipping-order.fields.groupId',
    filterable: true,
  })
  get groupId(): string {
    return this.#groupId;
  }
  set groupId(value: string) {
    this.#groupId = value;
  }

  /** The delivery flow waiting on this shipment, which its events signal. */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.flowId',
    sortable: false,
    filterable: false,
  })
  get flowId(): string | undefined {
    return this.#flowId;
  }
  set flowId(value: string | undefined) {
    this.#flowId = value;
  }

  /** How the buyer pays. `cod` is what makes {@link amountDue} the courier's to collect. */
  @accessor({
    type: 'enum',
    labelKey: 'entity:shipping-order.fields.paymentMethod',
    enumValues: OrderTenders,
    enumLabelKey: 'entity:shipping-order.values.paymentMethod',
    required: true,
    filterable: true,
  })
  get paymentMethod(): OrderTender {
    return this.#paymentMethod;
  }
  set paymentMethod(value: OrderTender) {
    this.#paymentMethod = value;
  }

  /** Minor units the courier collects on delivery: the order total for `cod`, zero otherwise. */
  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.amountDue',
    money: { unit: 'minor', currencyMember: 'currency' },
    filterable: false,
  })
  get amountDue(): number {
    return this.#amountDue;
  }
  set amountDue(value: number) {
    this.#amountDue = value;
  }

  /**
   * The order's taxable base and tax, and the seller's regime, as the checkout
   * stated them: what a cash collection records into its allocation, so money
   * taken at the door carries its tax like money taken by card (ADR 0078 §6).
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.taxableBase',
    money: { unit: 'minor', currencyMember: 'currency' },
    filterable: false,
  })
  get taxableBase(): number {
    return this.#taxableBase;
  }
  set taxableBase(value: number) {
    this.#taxableBase = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.taxAmount',
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
    type: 'string',
    labelKey: 'entity:shipping-order.fields.taxRegime',
    filterable: false,
  })
  get taxRegime(): string {
    return this.#taxRegime;
  }
  set taxRegime(value: string) {
    this.#taxRegime = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.currency',
    filterable: false,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  /**
   * What goes in the parcel. A `composition`: owned by this record and written
   * with it ([ADR 0034](../../../../../../docs/adr/0034-composition-metadata.md)).
   */
  @accessor({
    type: 'composition',
    childType: () => ShippingLine,
    labelKey: 'entity:shipping-order.fields.lines',
  })
  get lines(): readonly ShippingLine[] {
    return this.#lines;
  }
  set lines(value: readonly ShippingLine[]) {
    this.#lines = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:shipping-order.fields.status',
    enumValues: ShippingStatuses,
    enumTones: ShippingStatusTones,
    enumLabelKey: 'entity:shipping-order.values.status',
    // Declared, or `paymentMethod` — the first enum — takes the badge.
    card: 'badge',
    required: true,
    filterable: true,
  })
  get status(): ShippingStatus {
    return this.#status;
  }
  set status(value: ShippingStatus) {
    this.#status = value;
  }

  /** When the parcel left with a courier. Server-owned and writable anyway: `readonly` would drop it from deserialization too. */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.dispatchedAt',
    sortable: true,
    filterable: true,
  })
  get dispatchedAt(): Date | undefined {
    return this.#dispatchedAt;
  }
  set dispatchedAt(value: Date | undefined) {
    this.#dispatchedAt = value;
  }

  /** When the courier handed it over. Server-owned and writable anyway: `readonly` would drop it from deserialization too. */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.deliveredAt',
    sortable: true,
    filterable: true,
  })
  get deliveredAt(): Date | undefined {
    return this.#deliveredAt;
  }
  set deliveredAt(value: Date | undefined) {
    this.#deliveredAt = value;
  }

  /** When the buyer refused it at the door. Server-owned and writable anyway: `readonly` would drop it from deserialization too. */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.refusedAt',
    sortable: true,
    filterable: true,
  })
  get refusedAt(): Date | undefined {
    return this.#refusedAt;
  }
  set refusedAt(value: Date | undefined) {
    this.#refusedAt = value;
  }

  /** When it came back to the vendor. Server-owned and writable anyway: `readonly` would drop it from deserialization too. */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.returnedAt',
    sortable: true,
    filterable: true,
  })
  get returnedAt(): Date | undefined {
    return this.#returnedAt;
  }
  set returnedAt(value: Date | undefined) {
    this.#returnedAt = value;
  }

  /**
   * When a cancellation withdrew it before dispatch: the moment its job ended,
   * which the retention sweep counts from (ADR 0076 §4). Server-owned and
   * writable anyway, as the other stamps are.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.withdrawnAt',
    sortable: true,
    filterable: true,
  })
  get withdrawnAt(): Date | undefined {
    return this.#withdrawnAt;
  }
  set withdrawnAt(value: Date | undefined) {
    this.#withdrawnAt = value;
  }
  /** The courier's dictionary key, copied at the guide (ADR 0081 §10). */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.courierKey',
  })
  get courierKey(): string | undefined {
    return this.#courierKey;
  }
  set courierKey(value: string | undefined) {
    this.#courierKey = value;
  }

  /** The courier's name as it was at the guide: a dictionary edit changes no parcel on its way. */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.courierName',
  })
  get courierName(): string | undefined {
    return this.#courierName;
  }
  set courierName(value: string | undefined) {
    this.#courierName = value;
  }

  /** The guide's number, what the buyer quotes to the courier (ADR 0081 §11). Server-owned, written by `record-guide`. */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.trackingNumber',
  })
  get trackingNumber(): string | undefined {
    return this.#trackingNumber;
  }
  set trackingNumber(value: string | undefined) {
    this.#trackingNumber = value;
  }

  /** Where the buyer follows the parcel, rendered from the courier's template at the guide; absent when the courier has no tracking page. */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.trackingUrl',
  })
  get trackingUrl(): string | undefined {
    return this.#trackingUrl;
  }
  set trackingUrl(value: string | undefined) {
    this.#trackingUrl = value;
  }

  /** When the guide was last recorded. Server-owned and writable anyway, as the other stamps are. */
  @accessor({
    type: 'date',
    labelKey: 'entity:shipping-order.fields.guideRecordedAt',
    sortable: true,
    filterable: true,
  })
  get guideRecordedAt(): Date | undefined {
    return this.#guideRecordedAt;
  }
  set guideRecordedAt(value: Date | undefined) {
    this.#guideRecordedAt = value;
  }
  // #endregion
}
