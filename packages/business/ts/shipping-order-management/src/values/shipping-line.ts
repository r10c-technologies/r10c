import { accessor } from '@entifix/core';

/**
 * One line of a shipment: what goes in the parcel, and what it was sold for.
 *
 * A **value**, the child of {@link ShippingOrder}'s `composition` member and
 * described by its accessors alone
 * ([ADR 0034](../../../../../docs/adr/0034-composition-metadata.md)). A line off
 * the wire is a plain object, so nothing may test `instanceof ShippingLine`.
 */
export class ShippingLine {
  // #region properties
  #offeringId: string;
  #quantity: number;
  // #endregion

  // #region constructors
  constructor(offeringId = '', quantity = 0) {
    this.#offeringId = offeringId;
    this.#quantity = quantity;
  }
  // #endregion

  // #region accessors
  @accessor({
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
