import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * What one vendor is owed for one {@link SettlementRun}.
 *
 * The fold of that vendor's {@link CommissionEntry} lines for the period,
 * materialized — the same relationship `StockItem` has to `StockMovement`, and
 * for the same reason: the ledger is the truth and the total is the thing people
 * read. A payout that could not be traced back to its entries would be a number
 * nobody can defend in a dispute.
 *
 * `runId` rather than a date range on the payout itself, so "everything in the
 * March run" is one query and a re-run cannot half-replace a period.
 *
 * This is the surface that generalizes furthest: any partner revenue share, in
 * any future non-commerce application, is this shape with a different ledger
 * feeding it.
 *
 * Control plane, `settlement` store.
 */
@entity({
  domain: 'settlement-management',
  key: 'vendor-payout',
  labelKey: 'entity:vendor-payout.label',
  pluralKey: 'entity:vendor-payout.plural',
})
export class VendorPayout implements Entity {
  // #region properties
  #id?: EntityId;
  #runId: string;
  #vendorId: string;
  #amount: number;
  #currency: string;
  // #endregion

  // #region constructors
  constructor(runId = '', vendorId = '', amount = 0, currency = '') {
    this.#runId = runId;
    this.#vendorId = vendorId;
    this.#amount = amount;
    this.#currency = currency;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:vendor-payout.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:vendor-payout.fields.runId',
    required: true,
    filterable: true,
  })
  get runId(): string {
    return this.#runId;
  }
  set runId(value: string) {
    this.#runId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:vendor-payout.fields.vendorId',
    required: true,
    filterable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  /** Minor units. The fold of this vendor's commission entries for the run. */
  @accessor({
    type: 'number',
    labelKey: 'entity:vendor-payout.fields.amount',
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
    labelKey: 'entity:vendor-payout.fields.currency',
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
