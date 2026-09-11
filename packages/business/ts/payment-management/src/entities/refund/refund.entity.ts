import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import { type RefundStatus, RefundStatuses } from '../../values/refund-status';

/**
 * Money going back for an order, and how it went.
 *
 * **Its own record, not a status on the {@link Payment} it reverses.**
 * [ADR 0054](../../../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)
 * protects the capture row deliberately — "a delete permission would authorize
 * erasing the evidence that a customer was charged" — and a `'refunded'` status
 * written over the capture would erase the same evidence by a different route.
 * A refund with its own id, its own provider reference and its own decision
 * time leaves the capture untouched and gives reconciliation two rows to join
 * ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * It carries **both** ids. `paymentId` is what it reverses and is the unique key
 * that stops one capture being refunded twice; `orderId` is how it is addressed,
 * because the cancellation saga holds an order and has never seen a payment id.
 *
 * `amount` is an integer in the currency's minor unit, like every other money
 * member in this repo, and it is copied off the resolved capture rather than
 * taken from the caller — a request that can name its own refund amount is a
 * request that can refund more than was ever charged.
 *
 * ⚠️ **The whole capture, never a part of it.** Partial refunds are out of v1
 * scope and the unique index on `paymentId` is what keeps that true in storage
 * rather than in review. Adding them later means dropping that index and giving
 * this record a reason to exist more than once per payment, which is a decision
 * rather than a migration.
 *
 * `providerReference` is the provider's own id for the refund — a *second*
 * reference, never the capture's. Absent for cash, which has no provider to
 * answer, and absent until the provider has been called.
 */
@entity({
  domain: 'payment-management',
  key: 'refund',
  labelKey: 'entity:refund.label',
  pluralKey: 'entity:refund.plural',
})
export class Refund implements Entity {
  // #region properties
  #id?: EntityId;
  #paymentId: string;
  #orderId: string;
  #amount: number;
  #currency: string;
  #status: RefundStatus = 'pending';
  #providerReference?: string;
  #decidedAt?: Date;
  // #endregion

  // #region constructors
  constructor(orderId = '', paymentId = '', amount = 0, currency = '') {
    this.#orderId = orderId;
    this.#paymentId = paymentId;
    this.#amount = amount;
    this.#currency = currency;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:refund.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The capture this reverses. Server-owned: the route resolves it from the
   * order rather than accepting it, so a caller cannot aim a refund at a payment
   * that belongs to a different order.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:refund.fields.paymentId',
    required: true,
    filterable: true,
  })
  get paymentId(): string {
    return this.#paymentId;
  }
  set paymentId(value: string) {
    this.#paymentId = value;
  }

  /**
   * The order the money was taken for. A plain id, not a `link`: the target is
   * another slice's store, and a link would invite the storage-layer join the
   * one-writer rule forbids.
   *
   * This is the member the route is addressed by — `POST /api/refund` names an
   * order, because the cancellation saga holds one and has never seen a payment.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:refund.fields.orderId',
    required: true,
    filterable: true,
  })
  get orderId(): string {
    return this.#orderId;
  }
  set orderId(value: string) {
    this.#orderId = value;
  }

  /** Minor units, copied off the capture. See `Payment.amount`. */
  @accessor({
    type: 'number',
    labelKey: 'entity:refund.fields.amount',
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
    labelKey: 'entity:refund.fields.currency',
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
    labelKey: 'entity:refund.fields.status',
    enumValues: RefundStatuses,
    enumLabelKey: 'entity:refund.values.status',
    required: true,
    filterable: true,
  })
  get status(): RefundStatus {
    return this.#status;
  }
  set status(value: RefundStatus) {
    this.#status = value;
  }

  /**
   * The provider's own id for the refund, not for the capture. Filterable
   * because reconciliation starts from the provider's side.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:refund.fields.providerReference',
    filterable: true,
  })
  get providerReference(): string | undefined {
    return this.#providerReference;
  }
  set providerReference(value: string | undefined) {
    this.#providerReference = value;
  }

  /**
   * When the provider answered.
   *
   * A real member rather than a bare document field, which is the difference
   * between a timestamp and a value nobody can read: a member without a getter
   * is invisible to every adapter, so it reaches no serialization, no table
   * column and no form (#249).
   *
   * ⚠️ `Payment.decidedAt` is written the same way and still has no accessor, so
   * the capture's own decision time has exactly that defect today. Named here
   * rather than fixed, because it is a different record's member.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:refund.fields.decidedAt',
    sortable: true,
    filterable: true,
  })
  get decidedAt(): Date | undefined {
    return this.#decidedAt;
  }
  set decidedAt(value: Date | undefined) {
    this.#decidedAt = value;
  }
  // #endregion
}
