import { Entity, EntityId, EntityLink } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import { ProductBrand } from '../product-brand';
import { ProductCategory } from '../product-category';

@entity({
  domain: 'product-configuration-management',
  key: 'product',
  labelKey: 'entity:product.label',
  pluralKey: 'entity:product.plural',
})
export class Product implements Entity {
  // #region properties
  #id?: EntityId;
  #code: string;
  #name: string;
  #description?: string;
  #brand: EntityLink<ProductBrand>;
  #category: EntityLink<ProductCategory>;
  // #endregion

  // #region constructors
  constructor(code: string, name: string) {
    this.#code = code;
    this.#name = name;

    // POssible initialization of links to related entities. Open to discussion and review. The idea is to have a way to link related entities, such as brand and category, to the product entity. This can be useful for loading related data when needed.
    this.#brand = new EntityLink(ProductBrand);
    this.#category = new EntityLink(ProductCategory);
  }
  // #endregion

  // #region methods
  // #endregion

  // #region accessors
  @accessor({ type: 'id', label: 'ID', labelKey: 'entity:product.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Code',
    labelKey: 'entity:product.fields.code',
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
    labelKey: 'entity:product.fields.name',
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
    labelKey: 'entity:product.fields.description',
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  // The catalog stores a product's brand inline, so the relation declares it:
  // `applyEntityLinks` then hands the link the whole instance and the serializer
  // embeds it, while `category` (default `id`) travels as a foreign key. The wire
  // shape is a property of the relation, not of whichever form last edited it.
  @accessor({
    type: 'link',
    label: 'Brand',
    labelKey: 'entity:product.fields.brand',
    linkSerialization: 'embedded',
  })
  get brand(): EntityLink<ProductBrand> {
    return this.#brand;
  }

  @accessor({
    type: 'link',
    label: 'Category',
    labelKey: 'entity:product.fields.category',
  })
  get category(): EntityLink<ProductCategory> {
    return this.#category;
  }
  // #endregion
}
