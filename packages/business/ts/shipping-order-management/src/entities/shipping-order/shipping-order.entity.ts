import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  type OrderTender,
  OrderTenders,
} from '@r10c/business-ts-sales-vocabulary';

import { ShippingLine } from '../../values/shipping-line';
import {
  type ShippingStatus,
  ShippingStatuses,
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
  domain: 'shipping-order-management',
  key: 'shipping-order',
  labelKey: 'entity:shipping-order.label',
  pluralKey: 'entity:shipping-order.plural',
})
export class ShippingOrder implements Entity {
  // #region properties
  #id?: EntityId;
  #orderId = '';
  #groupId = '';
  #flowId?: string;
  #paymentMethod: OrderTender = 'card';
  #amountDue = 0;
  #currency = '';
  #lines: readonly ShippingLine[] = [];
  #status: ShippingStatus = 'awaiting-dispatch';
  #dispatchedAt?: Date;
  #deliveredAt?: Date;
  #refusedAt?: Date;
  #returnedAt?: Date;
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

  /** The checkout group the order belongs to. */
  @accessor({
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
    filterable: false,
  })
  get amountDue(): number {
    return this.#amountDue;
  }
  set amountDue(value: number) {
    this.#amountDue = value;
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
    enumLabelKey: 'entity:shipping-order.values.status',
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
  // #endregion
}
