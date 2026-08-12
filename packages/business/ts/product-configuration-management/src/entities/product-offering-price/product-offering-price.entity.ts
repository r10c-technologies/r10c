import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * A price attached to an offering.
 *
 * Separable from the offering on purpose — SID models it as its own entity so
 * one offering can be priced several ways at once: a list price and a
 * promotional one, a per-currency price, a recurring price beside a one-off.
 * Folding the amount into `ProductOffering` would make each of those a second
 * offering, which is the modelling mistake that turns a subscription into a new
 * catalog rather than a new price.
 *
 * That is exactly the extension named in BUSINESS-ARCHITECTURE's "how each
 * module extends": a recurring price here is a subscription, and a usage price
 * is a metered service, with no change to the offering.
 *
 * `amount` is an integer in the currency's **minor unit** — cents, not a float.
 * A binary float cannot represent 0.10 exactly, and money that is off by a
 * rounding error is money a settlement run has to reconcile by hand.
 *
 * The rating *function* is not here either: SID's `PricingLogicAlgorithm` models
 * the seam and not the behaviour, which is a port, and it is where promotions
 * and tiered pricing land later.
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  domain: 'product-configuration-management',
  key: 'product-offering-price',
  labelKey: 'entity:product-offering-price.label',
  pluralKey: 'entity:product-offering-price.plural',
})
export class ProductOfferingPrice implements Entity {
  // #region properties
  #id?: EntityId;
  #offeringId: string;
  #amount: number;
  #currency: string;
  // #endregion

  // #region constructors
  constructor(offeringId = '', amount = 0, currency = '') {
    this.#offeringId = offeringId;
    this.#amount = amount;
    this.#currency = currency;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:product-offering-price.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-offering-price.fields.offeringId',
    required: true,
    filterable: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  /** Minor units. `1050` with currency `EUR` is €10.50. */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-offering-price.fields.amount',
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

  /**
   * ISO 4217, as a plain string rather than an enum: the closed sets in this
   * repo are the ones that select a storage boundary or a permission, and a
   * currency selects neither. Narrowing it would mean a platform release to
   * accept a vendor's currency.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-offering-price.fields.currency',
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
