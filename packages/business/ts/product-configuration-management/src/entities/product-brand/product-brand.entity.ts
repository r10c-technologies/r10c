import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

@entity({ domain: 'product-configuration-management', key: 'product-brand' })
export class ProductBrand implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #description?: string;
  #website?: string;
  // #endregion

  // #region constructors
  constructor(name: string) {
    this.#name = name;
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
  get website(): string | undefined {
    return this.#website;
  }
  set website(value: string | undefined) {
    this.#website = value;
  }
  // #endregion
}
