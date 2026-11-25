import { accessor } from '@entifix/core';
import {
  VARIANT_AXES,
  type VariantAxis,
  type VariantValue,
} from '@r10c/business-ts-sales-vocabulary';

/**
 * One row of a `variantValues` composition — a **value**, not an entity: it
 * has no id and is never addressed apart from the offering that holds it
 * ([ADR 0085](../../../../../../docs/adr/0085-variants-are-offerings.md)).
 *
 * Declared here rather than in either domain for the reason `MediaReference`
 * is: `ProductOffering` records it and `PublishedOffering` projects it.
 */
export class VariantValueEntry implements VariantValue {
  #axis: VariantAxis;
  #value: string;

  constructor(axis: VariantAxis = 'color', value = '') {
    this.#axis = axis;
    this.#value = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:variant-value.fields.axis',
    enumValues: VARIANT_AXES,
    enumLabelKey: 'entity:variant-value.values.axis',
    required: true,
  })
  get axis(): VariantAxis {
    return this.#axis;
  }
  set axis(value: VariantAxis) {
    this.#axis = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:variant-value.fields.value',
    required: true,
  })
  get value(): string {
    return this.#value;
  }
  set value(value: string) {
    this.#value = value;
  }
}
