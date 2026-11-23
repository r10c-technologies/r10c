import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import {
  SALE_UNIT_NAME_KEY,
  SALE_UNIT_SCALES,
  SALE_UNIT_SYMBOL_KEY,
  type SaleUnit,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';

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
  // A hold is taken by checkout's crossing per ADR 0023, never by a person.
  creatable: false,
})
export class Reservation implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  #quantity: number;
  // No default: a unit nobody stated is absent, never `UN` (ADR 0082 §4).
  #unit?: SaleUnit;
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

  // `sortable` as well as `filterable`, and not for the table's sake: this
  // metadata is simultaneously the server-side allowlist, and it is the only
  // member of these entities that can name one of their records — a search
  // source refuses a label member that is not sortable, at module load.
  @accessor({
    references: { entity: 'product-configuration-management:product-offering' },
    type: 'string',
    labelKey: 'entity:reservation.fields.offeringId',
    required: true,
    filterable: true,
    sortable: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  /**
   * What `quantity` is counted in; a hold in another unit than the item's is
   * refused `unitMismatch` (ADR 0082 §4).
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:reservation.fields.unit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
    required: true,
    filterable: true,
  })
  get unit(): SaleUnit | undefined {
    return this.#unit;
  }
  set unit(value: SaleUnit | undefined) {
    this.#unit = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:reservation.fields.quantity',
    required: true,
    // In the unit's scale: compared across rows it compares metres with pieces.
    sortable: false,
    filterable: false,
    scaled: {
      unitMember: 'unit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
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
