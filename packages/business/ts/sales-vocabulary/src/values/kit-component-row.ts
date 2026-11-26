import { accessor } from '@entifix/core';

import type { KitComponent, KitStock } from './kit';
import type { SaleUnit } from './sale-unit';

/**
 * Here rather than beside the publication because four domains hold a kit's
 * rows — the offering authors them, and the projection, the order line and the
 * shipment line copy them — and a domain may reach the vocabulary but never
 * another domain.
 *
 * One row of an offering's `kitComponents` composition as the vendor authors
 * it: another offering of theirs, and how many one kit holds
 * ([ADR 0086](../../../../../../docs/adr/0086-a-kit-sells-several-offerings-at-one-price.md)).
 * A **value**, never addressed apart from the kit that holds it (ADR 0034).
 */
export class KitComponentRow implements KitComponent {
  #offeringId: string;
  #quantity: number;

  constructor(offeringId = '', quantity = 1) {
    this.#offeringId = offeringId;
    this.#quantity = quantity;
  }

  @accessor({
    type: 'id',
    labelKey: 'entity:kit-component.fields.offeringId',
    required: true,
    references: { entity: 'product-configuration-management:product-offering' },
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:kit-component.fields.quantity',
    required: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }
}

/**
 * One row of a kit as it is sold: a component and its count, plus what one kit
 * takes from stock, resolved at publication. Held by the published offering,
 * the order line and the shipment line, which copy it rather than read it.
 */
// Not a subclass of KitComponentRow: a class's accessor metadata is its own,
// so a subclass would describe only the members it adds.
export class KitStockRow implements KitStock {
  #offeringId: string;
  #quantity: number;
  #stockOfferingId: string;
  #stockUnit: SaleUnit;
  #stockQuantity: number;

  constructor(
    offeringId = '',
    quantity = 1,
    stockOfferingId = '',
    stockUnit: SaleUnit = 'UN',
    stockQuantity = 1,
  ) {
    this.#offeringId = offeringId;
    this.#quantity = quantity;
    this.#stockOfferingId = stockOfferingId;
    this.#stockUnit = stockUnit;
    this.#stockQuantity = stockQuantity;
  }

  @accessor({
    type: 'id',
    labelKey: 'entity:kit-component.fields.offeringId',
    required: true,
    references: { entity: 'product-configuration-management:product-offering' },
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:kit-component.fields.quantity',
    required: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({
    type: 'id',
    labelKey: 'entity:kit-component.fields.stockOfferingId',
    required: true,
    references: { entity: 'product-configuration-management:product-offering' },
  })
  get stockOfferingId(): string {
    return this.#stockOfferingId;
  }
  set stockOfferingId(value: string) {
    this.#stockOfferingId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:kit-component.fields.stockUnit',
    required: true,
  })
  get stockUnit(): SaleUnit {
    return this.#stockUnit;
  }
  set stockUnit(value: SaleUnit) {
    this.#stockUnit = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:kit-component.fields.stockQuantity',
    required: true,
  })
  get stockQuantity(): number {
    return this.#stockQuantity;
  }
  set stockQuantity(value: number) {
    this.#stockQuantity = value;
  }
}
