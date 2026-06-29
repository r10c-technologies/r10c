import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor,entity } from '@r10c/entifix-ts-core';

@entity({ name: 'product-category' })
export class ProductCategory implements Entity {
  //#region Properties
  #id?: EntityId;
  #code: string;
  #name: string;
  #description?: string;

  //#endregion

  //#region Constructors
  constructor(code: string, name: string) {
    this.#code = code;
    this.#name = name;
  }
  //#endregion

  //#region Methods

  //#endregion

  //#region Accessors
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
  //#endregion
}
