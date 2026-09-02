import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * One entry in the platform-owned characteristic vocabulary: a code, the values
 * it may take, and the unit they are in.
 *
 * This is what makes vendor-authored characteristics **comparable**, and it is
 * the answer to the obvious objection to letting vendors design their own
 * products. Free-form authoring leaves a vendor unblocked but not comparable —
 * two vendors' `talla` and `size` cannot share a facet, and a storefront filter
 * over them returns nothing useful. A term is the shared thing both may resolve
 * to.
 *
 * A vendor may **narrow** a term's value set, never widen it. Widening would let
 * one vendor redefine a term every other vendor is already classified under,
 * which is the same failure as a per-vendor category tree: the platform loses
 * the ability to merge.
 *
 * The vocabulary is meant to **grow from usage**, not to be designed up front —
 * the free-form codes that turn out to recur across tenants are the candidates
 * ([ADR 0014](../../../../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)).
 *
 * Platform plane, `catalog-reference` store — system-of-record, deliberately not
 * the `published-catalog` store beside it. Reference data is authored here;
 * the published catalog is a projection, and one store carries one `truth`.
 */
@entity({
  domain: 'catalog-reference',
  key: 'dictionary-term',
  labelKey: 'entity:dictionary-term.label',
  pluralKey: 'entity:dictionary-term.plural',
})
export class DictionaryTerm implements Entity {
  // #region properties
  #id?: EntityId;
  #code: string;
  #values: readonly string[] = [];
  #unit?: string;
  // #endregion

  // #region constructors
  constructor(code = '') {
    this.#code = code;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:dictionary-term.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /** The platform's name for the concept. Unique, and what a vendor resolves to. */
  @accessor({
    type: 'string',
    labelKey: 'entity:dictionary-term.fields.code',
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

  /**
   * The permitted value set. A **`scalarCollection`** — like
   * `Membership.roleIds` — never queryable, because member metadata is also the
   * server-side allowlist and an array compared as a scalar matches nothing.
   *
   * Empty means an open term: a code and a unit with no enumerated values, which
   * is the right shape for something like `weight`.
   */
  @accessor({
    type: 'scalarCollection',
    labelKey: 'entity:dictionary-term.fields.values',
  })
  get values(): readonly string[] {
    return this.#values;
  }
  set values(value: readonly string[]) {
    this.#values = value;
  }

  /**
   * The unit the values are in, when they have one. Part of the term rather
   * than of each vendor's characteristic, because two vendors quoting grams and
   * kilograms under one term is exactly the incomparability the dictionary
   * exists to remove.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:dictionary-term.fields.unit',
    filterable: true,
  })
  get unit(): string | undefined {
    return this.#unit;
  }
  set unit(value: string | undefined) {
    this.#unit = value;
  }
  // #endregion
}
