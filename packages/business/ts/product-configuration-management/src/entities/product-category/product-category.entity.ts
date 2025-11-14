import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { entity, accessor } from '@r10c/entifix-ts-core';

@entity()
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
  @accessor()
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get code(): string {
    return this.#code;
  }
  @accessor()
  set code(value: string) {
    this.#code = value;
  }

  @accessor()
  get name(): string {
    return this.#name;
  }
  @accessor()
  set name(value: string) {
    this.#name = value;
  }

  @accessor()
  get description(): string | undefined {
    return this.#description;
  }
  @accessor()
  set description(value: string | undefined) {
    this.#description = value;
  }
  //#endregion
}
