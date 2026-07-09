import { Entity, EntityId, EntityLink } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import { ProductBrand } from '../product-brand';
import { ProductCategory } from '../product-category';

@entity({ domain: 'product-configuration-management', key: 'product' })
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
  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    this.#code = value;
  }

  @accessor()
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor()
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  @accessor()
  get brand(): EntityLink<ProductBrand> {
    return this.#brand;
  }

  @accessor()
  get category(): EntityLink<ProductCategory> {
    return this.#category;
  }
  // #endregion
}
