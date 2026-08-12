import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type ReservationStatus,
  ReservationStatuses,
} from '../../values/reservation-status';

/**
 * A time-limited hold on stock, taken at checkout.
 *
 * A purchase **reserves**; it does not decrement. Taking the hold is a
 * conditional atomic write — increment `reserved` only where
 * `onHand - reserved >= quantity` — and that condition *is* the concurrency
 * control: zero rows matched means out of stock, answered immediately, with no
 * lock to acquire and no contention ceiling. A Redis lock per product would
 * serialize every purchase of a popular item through one key.
 *
 * The design is forced by **payment latency**, not by service topology: a
 * database transaction cannot be held open across an external payment call, so
 * reservations would be required even with one database
 * ([ADR 0010](../../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * order-management holds a *reservation id*, never a quantity — which is what
 * lets a failed order write compensate by releasing the hold rather than by
 * trying to reverse an arithmetic operation it did not perform.
 *
 * Tenant plane, `stock` store. The cross-plane call that creates one is
 * ADR 0023's, since a buyer's session carries no organization and the vendor
 * comes from the item.
 */
@entity({
  domain: 'stock-management',
  key: 'reservation',
  labelKey: 'entity:reservation.label',
  pluralKey: 'entity:reservation.plural',
})
export class Reservation implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  #quantity: number;
  #status: ReservationStatus = 'held';
  #expiresAt?: Date;
  // #endregion

  // #region constructors
  constructor(offeringId = '', quantity = 0) {
    this.#offeringId = offeringId;
    this.#quantity = quantity;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:reservation.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:reservation.fields.offeringId',
    required: true,
    filterable: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:reservation.fields.quantity',
    required: true,
    sortable: true,
    filterable: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:reservation.fields.status',
    enumValues: ReservationStatuses,
    enumLabelKey: 'entity:reservation.values.status',
    required: true,
    filterable: true,
  })
  get status(): ReservationStatus {
    return this.#status;
  }
  set status(value: ReservationStatus) {
    this.#status = value;
  }

  /**
   * When the hold lapses. Filterable and sortable because the release sweep is
   * exactly a query for expired holds still in `held`.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:reservation.fields.expiresAt',
    sortable: true,
    filterable: true,
  })
  get expiresAt(): Date | undefined {
    return this.#expiresAt;
  }
  set expiresAt(value: Date | undefined) {
    this.#expiresAt = value;
  }
  // #endregion
}
