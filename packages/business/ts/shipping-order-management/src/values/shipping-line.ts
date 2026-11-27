import { accessor } from '@entifix/core';
import {
  type KitStock,
  KitStockRow,
  SALE_UNIT_NAME_KEY,
  SALE_UNIT_SCALES,
  SALE_UNIT_SYMBOL_KEY,
  type SaleUnit,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';

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
  // No default: a parcel line states what its quantity is counted in.
  #unit?: SaleUnit;
  #quantity: number;
  #stockOfferingId?: string;
  #stockUnit?: SaleUnit;
  #stockQuantity?: number;
  #kitComponents?: readonly KitStock[];
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

  /** The order line's unit, so a packer reads 3.5 m and never 3500. */
  @accessor({
    type: 'enum',
    labelKey: 'entity:shipping-order.fields.line.unit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
    required: true,
  })
  get unit(): SaleUnit | undefined {
    return this.#unit;
  }
  set unit(value: SaleUnit | undefined) {
    this.#unit = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.line.quantity',
    required: true,
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

  /**
   * What the parcel line took from its base's stock, when it sold a presentation
   * (ADR 0082 §7): the base, the base's unit and how much, stated by the
   * checkout's coordinator and copied here, so a cancellation or a return
   * puts back exactly that whatever the factor reads by then. Absent on a
   * line that drew on no base.
   */
  @accessor({
    references: { entity: 'product-configuration-management:product-offering' },
    type: 'string',
    labelKey: 'entity:shipping-order.fields.line.stockOfferingId',
  })
  get stockOfferingId(): string | undefined {
    return this.#stockOfferingId;
  }
  set stockOfferingId(value: string | undefined) {
    this.#stockOfferingId = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:shipping-order.fields.line.stockUnit',
    enumValues: SaleUnits,
    enumLabelKey: SALE_UNIT_NAME_KEY,
  })
  get stockUnit(): SaleUnit | undefined {
    return this.#stockUnit;
  }
  set stockUnit(value: SaleUnit | undefined) {
    this.#stockUnit = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:shipping-order.fields.line.stockQuantity',
    scaled: {
      unitMember: 'stockUnit',
      units: SALE_UNIT_SCALES,
      unitLabelKey: SALE_UNIT_SYMBOL_KEY,
    },
  })
  get stockQuantity(): number | undefined {
    return this.#stockQuantity;
  }
  set stockQuantity(value: number | undefined) {
    this.#stockQuantity = value;
  }

  /**
   * What the line took from each component's stock, when it sold a kit
   * (ADR 0086): stated by the checkout's coordinator and copied here, so a
   * cancellation or a return puts back exactly that whatever the kit holds by
   * then. Absent on a line that sold no kit.
   */
  @accessor({
    type: 'composition',
    childType: () => KitStockRow,
    labelKey: 'entity:shipping-order.fields.line.kitComponents',
  })
  get kitComponents(): readonly KitStock[] | undefined {
    return this.#kitComponents;
  }
  set kitComponents(value: readonly KitStock[] | undefined) {
    this.#kitComponents = value;
  }
  // #endregion
}
