import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

@entity({ domain: 'product-configuration-management', key: 'product-brand' })
export class ProductBrand implements Entity {
  // #region properties
  #id?: EntityId;
  #code?: string;
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
  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  // Assigned by the create transaction (`brand-001`, `brand-002`, …); optional
  // because a raw payload arrives without one.
  @accessor({ type: 'string', label: 'Code' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({ type: 'string', label: 'Description' })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  @accessor({ type: 'string', label: 'Website' })
  get website(): string | undefined {
    return this.#website;
  }
  set website(value: string | undefined) {
    this.#website = value;
  }
  // #endregion
}
