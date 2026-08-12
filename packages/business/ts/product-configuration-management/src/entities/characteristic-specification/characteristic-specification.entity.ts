import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type CharacteristicValueType,
  CharacteristicValueTypes,
} from '../../values/characteristic-value-type';

/**
 * One member of an `EntitySpecification`: a code, a value type, and optionally
 * the platform vocabulary term it resolves to.
 *
 * `termId` is what makes a characteristic **comparable across vendors**, and it
 * is the reason free-form authoring does not end in an unusable catalog. Two
 * vendors writing `talla` and `size` leave both unblocked and neither
 * facetable; resolving both to one platform-owned `DictionaryTerm` gives the
 * storefront a facet without either vendor having asked permission to invent a
 * field. A vendor may **narrow** a term's value set, never widen it — widening
 * would let one vendor redefine a term every other vendor is already using.
 *
 * The vocabulary itself is deliberately not here: it is platform-owned reference
 * data in `catalog-reference`, and it grows from the free-form codes that turn
 * out to recur across tenants
 * ([ADR 0014](../../../../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)).
 *
 * A characteristic is never routed into the RSQL allowlist — the allowlist is
 * member metadata on a typed entity, and a characteristic is data.
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  domain: 'product-configuration-management',
  key: 'characteristic-specification',
  labelKey: 'entity:characteristic-specification.label',
  pluralKey: 'entity:characteristic-specification.plural',
})
export class CharacteristicSpecification implements Entity {
  // #region properties
  #id?: EntityId;
  #specificationId: string;
  #code: string;
  #valueType: CharacteristicValueType;
  #termId?: string;
  // #endregion

  // #region constructors
  constructor(
    specificationId = '',
    code = '',
    valueType: CharacteristicValueType = 'string',
  ) {
    this.#specificationId = specificationId;
    this.#code = code;
    this.#valueType = valueType;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:characteristic-specification.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:characteristic-specification.fields.specificationId',
    required: true,
    filterable: true,
  })
  get specificationId(): string {
    return this.#specificationId;
  }
  set specificationId(value: string) {
    this.#specificationId = value;
  }

  /** The vendor's own name for the member. Unique within a specification. */
  @accessor({
    type: 'string',
    labelKey: 'entity:characteristic-specification.fields.code',
    required: true,
    sortable: true,
    filterable: true,
  })
  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    this.#code = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:characteristic-specification.fields.valueType',
    enumValues: CharacteristicValueTypes,
    enumLabelKey: 'entity:characteristic-specification.values.valueType',
    required: true,
    filterable: true,
  })
  get valueType(): CharacteristicValueType {
    return this.#valueType;
  }
  set valueType(value: CharacteristicValueType) {
    this.#valueType = value;
  }

  /**
   * The `DictionaryTerm` this characteristic resolves to, when it resolves to
   * one. Optional by design: requiring it would put the operator back on the
   * critical path of every onboarding, which is the problem specifications
   * exist to remove. Unresolved is usable but not comparable.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:characteristic-specification.fields.termId',
    filterable: true,
  })
  get termId(): string | undefined {
    return this.#termId;
  }
  set termId(value: string | undefined) {
    this.#termId = value;
  }
  // #endregion
}
