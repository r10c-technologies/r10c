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
 * {@link saleAmount} is captured beside it, so the line states the base as well
 * as the cut. Without it the entry says what the platform took and nothing about
 * what it took a share *of*, which makes it unauditable in exactly the dispute
 * capturing commission at sale time exists to survive — and leaves
 * {@link VendorPayout} with no way to total what the vendor is actually owed.
 *
 * {@link occurredAt} and {@link runId} are what a {@link SettlementRun} selects
 * on: the first says which period a line falls in, the second says whether some
 * run has already paid it. A ledger with neither can be folded once and never
 * twice.
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
  #saleAmount: number;
  #commissionAmount: number;
  #currency: string;
  #occurredAt?: Date;
  #runId?: string;
  // #endregion

  // #region constructors
  constructor(
    orderId = '',
    vendorId = '',
    saleAmount = 0,
    commissionAmount = 0,
    currency = '',
    occurredAt?: Date,
  ) {
    this.#orderId = orderId;
    this.#vendorId = vendorId;
    this.#saleAmount = saleAmount;
    this.#commissionAmount = commissionAmount;
    this.#currency = currency;
    this.#occurredAt = occurredAt;
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

  /**
   * Filterable: a payout is exactly "every entry for this vendor, unpaid" —
   * `vendorId` and an absent {@link runId}, which is that sentence as a query.
   *
   * Sortable as well, because it is the only member of this entity that can
   * name one of its records: a record search source refuses a label member that
   * is not simultaneously a string, filterable **and** sortable, and every other
   * member here is a number, a date or an opaque id.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:commission-entry.fields.vendorId',
    required: true,
    sortable: true,
    filterable: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  /**
   * What this vendor's lines on the order came to, in minor units, before the
   * platform's cut.
   *
   * The **base** the commission was a share of, captured for the same reason the
   * commission itself is. A payout is `saleAmount − commissionAmount` summed, so
   * without this member the fold below it can only total what the platform keeps
   * — and a vendor reading a statement cannot check the arithmetic against
   * anything.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:commission-entry.fields.saleAmount',
    required: true,
    sortable: true,
    filterable: true,
  })
  get saleAmount(): number {
    return this.#saleAmount;
  }
  set saleAmount(value: number) {
    this.#saleAmount = value;
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

  /**
   * When the sale this line is a cut of was paid for.
   *
   * ⚠️ **The capture's own timestamp, never `now`.** It is what a
   * {@link SettlementRun} compares against its period, so stamping the moment
   * the message happened to be handled would file a line under whichever period
   * the consumer was running in — and a redelivery, a replay or a rebuild would
   * file the same sale differently each time.
   *
   * Sortable and filterable because selecting a period is the only query a run
   * makes.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:commission-entry.fields.occurredAt',
    required: true,
    sortable: true,
    filterable: true,
  })
  get occurredAt(): Date | undefined {
    return this.#occurredAt;
  }
  set occurredAt(value: Date | undefined) {
    this.#occurredAt = value;
  }

  /**
   * The {@link SettlementRun} that has already folded this line, if one has.
   *
   * **Absent means unsettled**, and that is the whole mechanism: a run selects
   * the entries in its period that carry no run id and stamps itself onto them
   * in the same write, so a second run over the same period finds nothing left
   * and a vendor cannot be paid twice for one sale.
   *
   * Optional rather than nullable, and filterable so "unpaid" is expressible.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:commission-entry.fields.runId',
    filterable: true,
  })
  get runId(): string | undefined {
    return this.#runId;
  }
  set runId(value: string | undefined) {
    this.#runId = value;
  }
  // #endregion
}
