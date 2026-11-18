import { accessor } from '@entifix/core';

/**
 * One line of a shipment: what goes in the parcel, and what it was sold for.
 *
 * A **value**, the child of {@link ShippingOrder}'s `composition` member and
 * described by its accessors alone
 * ([ADR 0034](../../../../../docs/adr/0034-composition-metadata.md)). A line off
 * the wire is a plain object, so nothing may test `instanceof ShippingLine`.
 *
 * It keeps the **name** the offering was sold under, so a packing list still
 * reads as what was sold after the offering is renamed or retired (#582);
 * `offeringId` stays the link to the live one.
 */
export class ShippingLine {
  // #region properties
  #offeringId: string;
  #name: string;
  #quantity: number;
  // #endregion

  // #region constructors
  constructor(offeringId = '', name = '', quantity = 0) {
    this.#offeringId = offeringId;
    this.#name = name;
    this.#quantity = quantity;
  }
  // #endregion

  // #region accessors
  @accessor({
    references: { entity: 'product-configuration-management:product-offering' },
    type: 'string',
    labelKey: 'entity:shipping-order.fields.line.offeringId',
    required: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  /** What the offering was called when it was sold; never updated. */
  @accessor({
    type: 'string',
    labelKey: 'entity:shipping-order.fields.line.name',
    required: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.line.quantity',
    required: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }
  // #endregion
}
