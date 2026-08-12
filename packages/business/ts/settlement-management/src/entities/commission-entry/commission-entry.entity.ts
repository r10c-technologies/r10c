import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * One sale's commission, recorded when the sale happens rather than computed
 * when a payout is prepared.
 *
 * This is the ledger a {@link VendorPayout} is a fold of, and having it is what
 * makes a payout **reconstructible**. Computing commission at payout time
 * instead would mean re-reading orders through whatever the agreement says
 * *today*, so a rate change would silently rewrite history — the same class of
 * bug as storing a price by reference instead of capturing it.
 *
 * `commissionAmount` is captured, not derived from a rate held elsewhere, for
 * exactly that reason. The `Agreement` in force is an input at write time and
 * never read again for this line.
 *
 * Control plane, `settlement` store.
 */
@entity({
  domain: 'settlement-management',
  key: 'commission-entry',
  labelKey: 'entity:commission-entry.label',
  pluralKey: 'entity:commission-entry.plural',
})
export class CommissionEntry implements Entity {
  // #region properties
  #id?: EntityId;
  #orderId: string;
  #vendorId: string;
  #commissionAmount: number;
  #currency: string;
  // #endregion

  // #region constructors
  constructor(
    orderId = '',
    vendorId = '',
    commissionAmount = 0,
    currency = '',
  ) {
    this.#orderId = orderId;
    this.#vendorId = vendorId;
    this.#commissionAmount = commissionAmount;
    this.#currency = currency;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:commission-entry.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:commission-entry.fields.orderId',
    required: true,
    filterable: true,
  })
  get orderId(): string {
    return this.#orderId;
  }
  set orderId(value: string) {
    this.#orderId = value;
  }

  /** Filterable: a payout is exactly "every entry for this vendor, unpaid". */
  @accessor({
    type: 'string',
    labelKey: 'entity:commission-entry.fields.vendorId',
    required: true,
    filterable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  /** Minor units, captured at sale time under the agreement then in force. */
  @accessor({
    type: 'number',
    labelKey: 'entity:commission-entry.fields.commissionAmount',
    required: true,
    sortable: true,
    filterable: true,
  })
  get commissionAmount(): number {
    return this.#commissionAmount;
  }
  set commissionAmount(value: number) {
    this.#commissionAmount = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:commission-entry.fields.currency',
    required: true,
    filterable: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }
  // #endregion
}
