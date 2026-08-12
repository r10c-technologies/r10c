import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type PaymentStatus,
  PaymentStatuses,
} from '../../values/payment-status';

/**
 * One attempt to take money for an order, and how it went.
 *
 * The provider itself is a **port** — `PaymentProviderTag`, with a simulated
 * adapter in v1 — because payment service provider integration is deliberately
 * out of scope while the order state machine, the reservation-to-sale conversion
 * and settlement all need something real to run against. Swapping in a live PSP
 * is a `Layer` at a composition root, not a change here
 * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * `providerReference` is the PSP's own id for the attempt. It is the only member
 * that belongs to a foreign system, and it is stored rather than derived because
 * it is the sole handle for a reconciliation or a chargeback later.
 *
 * `amount` is an integer in the currency's minor unit, for the same reason as
 * `ProductOfferingPrice.amount`: money that is off by a float rounding error is
 * money someone reconciles by hand.
 *
 * Platform plane, `payment` store — its own store rather than a corner of
 * `order`, so that "which slice writes a payment?" has one answer and a future
 * PSP-facing process can be lifted out without touching orders.
 */
@entity({
  domain: 'payment-management',
  key: 'payment',
  labelKey: 'entity:payment.label',
  pluralKey: 'entity:payment.plural',
})
export class Payment implements Entity {
  // #region properties
  #id?: EntityId;
  #orderId: string;
  #amount: number;
  #currency: string;
  #status: PaymentStatus = 'pending';
  #providerReference?: string;
  // #endregion

  // #region constructors
  constructor(orderId = '', amount = 0, currency = '') {
    this.#orderId = orderId;
    this.#amount = amount;
    this.#currency = currency;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:payment.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The order being paid for. A plain id, not a `link`: the target is another
   * slice's store, and a link would invite the storage-layer join the
   * one-writer rule forbids.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:payment.fields.orderId',
    required: true,
    filterable: true,
  })
  get orderId(): string {
    return this.#orderId;
  }
  set orderId(value: string) {
    this.#orderId = value;
  }

  /** Minor units. See `ProductOfferingPrice.amount`. */
  @accessor({
    type: 'number',
    labelKey: 'entity:payment.fields.amount',
    required: true,
    sortable: true,
    filterable: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:payment.fields.currency',
    required: true,
    filterable: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:payment.fields.status',
    enumValues: PaymentStatuses,
    enumLabelKey: 'entity:payment.values.status',
    required: true,
    filterable: true,
  })
  get status(): PaymentStatus {
    return this.#status;
  }
  set status(value: PaymentStatus) {
    this.#status = value;
  }

  /**
   * The provider's own id for this attempt. Absent until the provider has been
   * called, and filterable because reconciliation starts from the PSP's side.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:payment.fields.providerReference',
    filterable: true,
  })
  get providerReference(): string | undefined {
    return this.#providerReference;
  }
  set providerReference(value: string | undefined) {
    this.#providerReference = value;
  }
  // #endregion
}
