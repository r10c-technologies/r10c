import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

@entity({
  domain: 'catalog-reference',
  key: 'product-category',
  labelKey: 'entity:product-category.label',
  pluralKey: 'entity:product-category.plural',
})
export class ProductCategory implements Entity {
  //#region properties
  #id?: EntityId;
  #code: string;
  #name: string;
  #description?: string;
  //#endregion

  //#region constructors
  constructor(code: string, name: string) {
    this.#code = code;
    this.#name = name;
  }
  //#endregion

  //#region methods

  //#endregion

  //#region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-category.fields.id',
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
    labelKey: 'entity:product-category.fields.code',
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
    labelKey: 'entity:product-category.fields.name',
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
    labelKey: 'entity:product-category.fields.description',
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }
  //#endregion
}
