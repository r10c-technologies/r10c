import { accessor } from '@entifix/core';
import {
  type PricePer,
  SALE_UNIT_NAME_KEY,
  SALE_UNIT_SCALES,
  SALE_UNIT_SYMBOL_KEY,
  type SaleUnit,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';
import {
  type ItemKind,
  ItemKinds,
  type TaxTreatment,
  TaxTreatments,
} from '@r10c/business-ts-tax-policy';

/**
 * One line of a vendor's order.
 *
 * A **value**, not an entity: it has no identity of its own and is never
 * addressed apart from the order that holds it, so it is embedded rather than
 * linked ([ADR 0022](../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * It names **no vendor**. An order belongs to one vendor and says so once, on
 * the order; the buyer's one receipt across vendors is the `CheckoutGroup`
 * ([ADR 0069](../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md)).
 *
 * The price is **captured here**, not read through to the offering. A buyer must
 * be charged the price they were shown, and an offering's price can change
 * between the cart and the payment. So is the **name**: a receipt and a
 * packing list are records of a sale, and an offering renamed or retired after
 * it must still read as what was sold (#582, ADR 0076). So are the
 * **description and the specification version** the offering was published
 * on: after placement nothing on a line is resolved by reference — not for a
 * receipt, not for a refund, not for the books (ADR 0079 §3). `offeringId`
 * stays for stock and navigation only.
 *
 * `reservationId` holds the stock hold this line took. order-management holds an
 * **id, never a quantity** — which is what lets a failed order compensate by
 * releasing the hold rather than by reversing arithmetic it never performed
 * ([ADR 0010](../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * ## Why this is a class with accessors, and not an interface
 *
 * It is the child of `ProductOrder`'s `composition` member, and a composition's
 * child is **described by its accessors** — that is the whole mechanism
 * ([ADR 0034](../../../../../docs/adr/0034-composition-metadata.md)). There is
 * no `@entity()` here and there must not be: `@accessor()` writes to this
 * class's own metadata bag with no help from it, and a value with no `id` has
 * no domain, no key and no permission namespace to declare.
 *
 * ⚠️ The class is a **shape declaration, not a runtime contract.** A line
 * arriving off the wire is a plain object — `deserializeSingleEntity` assigns
 * the embedded array through, and an autosaved draft must stay JSON
 * ([ADR 0032](../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md))
 * — so nothing may test `instanceof OrderItem`. Construct one when authoring;
 * read one as data.
 */
export class OrderItem {
  // #region properties
  #offeringId: string;
  #name: string;
  #description?: string;
  #specificationId = '';
  #specificationVersion = 0;
  #quantity: number;
  #amount: number;
  // No defaults: an order line states what it sold in and what its price was
  // for, or the order write refuses it (ADR 0082 §6).
  #saleUnit?: SaleUnit;
  #pricePer?: PricePer;
  #lineTotal = 0;
  #currency: string;
  #reservationId?: string;
  #kind: ItemKind = 'good';
  #taxTreatment: TaxTreatment = 'taxed';
  #taxRate = 0;
  #taxableBase = 0;
  #taxAmount = 0;
  // #endregion

  // #region constructors
  constructor(
    offeringId = '',
    name = '',
    quantity = 0,
    amount = 0,
    currency = '',
    reservationId?: string,
  ) {
    this.#offeringId = offeringId;
    this.#name = name;
    this.#quantity = quantity;
    this.#amount = amount;
    this.#currency = currency;
    this.#reservationId = reservationId;
  }
  // #endregion

  // #region accessors
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.offeringId',
    required: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  /**
   * What the offering was called when it was sold, copied from the published
   * projection the line was priced from, and never updated.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.name',
    required: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  /**
   * The specification's description as sold, when it had one — the only
   * optional member a line copies, since a specification may have none.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.description',
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  /**
   * The specification **version** the offering was published on, by its
   * record id and its number — the frozen content this line sold (ADR 0079
   * §2–§3). Copied from the published projection at placement.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.specificationId',
    required: true,
  })
  get specificationId(): string {
    return this.#specificationId;
  }
  set specificationId(value: string) {
    this.#specificationId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.specificationVersion',
    required: true,
  })
  get specificationVersion(): number {
    return this.#specificationVersion;
  }
  set specificationVersion(value: number) {
    this.#specificationVersion = value;
  }

  /** What one of this line is, copied from the offering at placement. */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.item.saleUnit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
    required: true,
  })
  get saleUnit(): SaleUnit | undefined {
    return this.#saleUnit;
  }
  set saleUnit(value: SaleUnit | undefined) {
    this.#saleUnit = value;
  }

  /** An integer in the unit's scale: 3500 is 3.5 m (ADR 0082 §2). */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.quantity',
    required: true,
    scaled: {
      unitMember: 'saleUnit',
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

  /**
   * Minor units, captured at checkout: what `pricePer` whole units cost. See
   * `ProductOfferingPrice.amount`.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.amount',
    money: { unit: 'minor', currencyMember: 'currency' },
    required: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  /** How many whole units `amount` buys: `1`, `100` or `1000`. */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.pricePer',
    required: true,
  })
  get pricePer(): PricePer | undefined {
    return this.#pricePer;
  }
  set pricePer(value: PricePer | undefined) {
    this.#pricePer = value;
  }

  /**
   * What the line costs, in minor units: `lineTotal` over its terms, computed
   * once by the checkout's coordinator and copied here (ADR 0082 §6). Every
   * total, capture, commission and tax sums this; nothing multiplies again.
   */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.lineTotal',
    money: { unit: 'minor', currencyMember: 'currency' },
    required: true,
  })
  get lineTotal(): number {
    return this.#lineTotal;
  }
  set lineTotal(value: number) {
    this.#lineTotal = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.currency',
    required: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  /** The stock hold this line took, released on cancellation. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.reservationId',
  })
  get reservationId(): string | undefined {
    return this.#reservationId;
  }
  set reservationId(value: string | undefined) {
    this.#reservationId = value;
  }
  /** What the line sells, and how it is taxed: stated by the coordinator, stored as told (ADR 0078 §6). */
  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.item.kind',
    enumValues: [...ItemKinds],
    enumLabelKey: 'entity:product-order.values.item.kind',
  })
  get kind(): ItemKind {
    return this.#kind;
  }
  set kind(value: ItemKind) {
    this.#kind = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.item.taxTreatment',
    enumValues: [...TaxTreatments],
    enumLabelKey: 'entity:product-order.values.item.taxTreatment',
  })
  get taxTreatment(): TaxTreatment {
    return this.#taxTreatment;
  }
  set taxTreatment(value: TaxTreatment) {
    this.#taxTreatment = value;
  }

  /** In basis points (`1200` = 12 %). */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.taxRate',
  })
  get taxRate(): number {
    return this.#taxRate;
  }
  set taxRate(value: number) {
    this.#taxRate = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.taxableBase',
    money: { unit: 'minor', currencyMember: 'currency' },
  })
  get taxableBase(): number {
    return this.#taxableBase;
  }
  set taxableBase(value: number) {
    this.#taxableBase = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.taxAmount',
    money: { unit: 'minor', currencyMember: 'currency' },
  })
  get taxAmount(): number {
    return this.#taxAmount;
  }
  set taxAmount(value: number) {
    this.#taxAmount = value;
  }
  // #endregion
}
