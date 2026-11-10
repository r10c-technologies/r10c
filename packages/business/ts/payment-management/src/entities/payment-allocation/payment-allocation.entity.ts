import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import {
  type PaymentMethod,
  PaymentMethods,
} from '../../values/payment-method';

/**
 * One vendor order's share of a payment.
 *
 * A checkout group is charged once and its vendor orders are paid by shares of
 * that charge, one allocation per order. Every later money question is a
 * question about one share: a vendor cancelling their order refunds their
 * allocation and nobody else's, a partial refund moves {@link refunded} towards
 * {@link captured} and never past it, and settlement folds a commission per
 * order from the allocation the capture announced
 * ([ADR 0069](../../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md)).
 *
 * ⚠️ **`refunded` is a counter, and a counter is never read-modify-written.**
 * The ledger takes a refund with a conditional `$inc` on this row, which is the
 * whole concurrency control for partial refunds.
 *
 * Platform plane, `payment` store, beside the {@link Payment} it splits.
 */
@entity({
  domain: 'payment-management',
  key: 'payment-allocation',
  labelKey: 'entity:payment-allocation.label',
  pluralKey: 'entity:payment-allocation.plural',
  // Written by the capture it allocates, one per order per ADR 0069.
  creatable: false,
})
export class PaymentAllocation implements Entity {
  // #region properties
  #id?: EntityId;
  #paymentId = '';
  #groupId = '';
  #orderId = '';
  #vendorId = '';
  #authorized = 0;
  #captured = 0;
  #refunded = 0;
  #currency = '';
  #paymentMethod: PaymentMethod = 'card';
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:payment-allocation.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** The payment this is a share of. */
  @accessor({
    type: 'string',
    labelKey: 'entity:payment-allocation.fields.paymentId',
    required: true,
    filterable: true,
  })
  get paymentId(): string {
    return this.#paymentId;
  }
  set paymentId(value: string) {
    this.#paymentId = value;
  }

  /** The checkout group the payment was for. */
  @accessor({
    type: 'string',
    labelKey: 'entity:payment-allocation.fields.groupId',
    required: true,
    filterable: true,
  })
  get groupId(): string {
    return this.#groupId;
  }
  set groupId(value: string) {
    this.#groupId = value;
  }

  /** The one vendor order this share paid for. Unique: an order is paid once. */
  @accessor({
    type: 'string',
    labelKey: 'entity:payment-allocation.fields.orderId',
    required: true,
    filterable: true,
  })
  get orderId(): string {
    return this.#orderId;
  }
  set orderId(value: string) {
    this.#orderId = value;
  }

  /** The vendor the order belongs to, copied so settlement folds without a join. */
  @accessor({
    type: 'string',
    labelKey: 'entity:payment-allocation.fields.vendorId',
    required: true,
    filterable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  /** Minor units the buyer agreed to pay for this order. */
  @accessor({
    type: 'number',
    labelKey: 'entity:payment-allocation.fields.authorized',
    required: true,
    filterable: false,
  })
  get authorized(): number {
    return this.#authorized;
  }
  set authorized(value: number) {
    this.#authorized = value;
  }

  /** Minor units actually taken for it. */
  @accessor({
    type: 'number',
    labelKey: 'entity:payment-allocation.fields.captured',
    required: true,
    filterable: false,
  })
  get captured(): number {
    return this.#captured;
  }
  set captured(value: number) {
    this.#captured = value;
  }

  /** Minor units given back so far. Moves by a guarded `$inc` only, never past `captured`. */
  @accessor({
    type: 'number',
    labelKey: 'entity:payment-allocation.fields.refunded',
    required: true,
    filterable: false,
  })
  get refunded(): number {
    return this.#refunded;
  }
  set refunded(value: number) {
    this.#refunded = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:payment-allocation.fields.currency',
    required: true,
    filterable: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  /** The tender the share was paid in, copied off its payment for a refund. */
  @accessor({
    type: 'enum',
    labelKey: 'entity:payment-allocation.fields.paymentMethod',
    enumValues: PaymentMethods,
    enumLabelKey: 'entity:payment.values.method',
    required: true,
    filterable: true,
  })
  get paymentMethod(): PaymentMethod {
    return this.#paymentMethod;
  }
  set paymentMethod(value: PaymentMethod) {
    this.#paymentMethod = value;
  }
  // #endregion
}
