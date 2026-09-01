import { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

/**
 * What a thing **is** — the facts common to every instance of it. Definitional,
 * not commercial.
 *
 * This class was called `Product` until
 * [ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md).
 * It was the wrong name, and expensively so: in SID a `Product` is an **instance
 * a party owns** after an order completes — what a subscription later becomes —
 * while a catalog record is a `ProductSpecification`. Holding the name here left
 * the owned instance with nowhere to live, and every month made the rename
 * larger, since the entity key is simultaneously the permission namespace, the
 * i18n catalog key, the route path and the Mongo collection name.
 *
 * The commercial half is deliberately elsewhere: `ProductOffering` is what is
 * orderable and priced, so one specification can be sold several ways without
 * being redefined.
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  domain: 'product-configuration-management',
  key: 'product-specification',
  labelKey: 'entity:product-specification.label',
  pluralKey: 'entity:product-specification.plural',
})
export class ProductSpecification implements Entity {
  // #region properties
  #id?: EntityId;
  #code: string;
  #name: string;
  #description?: string;
  #brandId?: string;
  #categoryId?: string;
  // #endregion

  // #region constructors
  constructor(code = '', name = '') {
    this.#code = code;
    this.#name = name;
  }
  // #endregion

  // #region methods
  // #endregion

  // #region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-specification.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Code',
    labelKey: 'entity:product-specification.fields.code',
    required: true,
  })
  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    this.#code = value;
  }

  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-specification.fields.name',
    required: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'string',
    label: 'Description',
    labelKey: 'entity:product-specification.fields.description',
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  /**
   * The brand and category this specification is classified under, as **plain
   * ids**.
   *
   * They were typed `EntityLink<ProductBrand>` / `EntityLink<ProductCategory>`,
   * resolved at the storage layer against the same tenant database. Both targets
   * now live in `catalog-reference` — platform plane, a different store with a
   * different writing slice — and the `business:domain` tag may not depend on
   * another `business:domain`, so the typed link is no longer a legal edge
   * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
   *
   * That prohibition is the rule working, not an obstacle. A storage-layer join
   * across a store boundary is exactly the coupling that would make this domain
   * unsplittable later; a cross-domain reference resolves through the owning
   * domain's use-case port instead, and the id is what that port takes.
   *
   * Filterable because "every specification in this category" is the vendor's
   * own list screen.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-specification.fields.brand',
    filterable: true,
  })
  get brandId(): string | undefined {
    return this.#brandId;
  }
  set brandId(value: string | undefined) {
    this.#brandId = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-specification.fields.category',
    filterable: true,
  })
  get categoryId(): string | undefined {
    return this.#categoryId;
  }
  set categoryId(value: string | undefined) {
    this.#categoryId = value;
  }
  // #endregion
}
