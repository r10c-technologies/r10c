import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

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
 * It carries **both** ids. `allocationId` is the share of a capture it gives
 * back; `orderId` is how it is addressed, because a cancellation holds an order
 * and has never seen a payment.
 *
 * `amount` is an integer in the currency's minor unit, like every other money
 * member in this repo. ⚠️ **It may be part of the allocation, never more than
 * what is left of it.** The ledger takes it with a conditional `$inc` guarded by
 * `refunded + amount <= captured`, *before* the provider is called, so two
 * refunds racing on one allocation can never send back more than was charged —
 * not at the provider, and not in the ledger
 * ([ADR 0069](../../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md)).
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
  #allocationId: string;
  #orderId: string;
  #amount: number;
  #currency: string;
  #status: RefundStatus = 'pending';
  #providerReference?: string;
  #decidedAt?: Date;
  // #endregion

  // #region constructors
  constructor(orderId = '', allocationId = '', amount = 0, currency = '') {
    this.#orderId = orderId;
    this.#allocationId = allocationId;
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
   * The allocation this gives money back from. Server-owned: the route
   * resolves it from the order rather than accepting it, so a caller cannot aim
   * a refund at money taken for a different order.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:refund.fields.allocationId',
    required: true,
    filterable: true,
  })
  get allocationId(): string {
    return this.#allocationId;
  }
  set allocationId(value: string) {
    this.#allocationId = value;
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
