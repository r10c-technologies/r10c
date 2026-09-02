import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  DEFAULT_REFERENCE_STATUS,
  type ReferenceStatus,
  ReferenceStatuses,
} from '../../values/reference-status';

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
  #status: ReferenceStatus = DEFAULT_REFERENCE_STATUS;
  //#endregion

  //#region constructors
  constructor(code = '', name = '') {
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

  // Declared for the same reason as `ProductBrand.name`: a specification holds
  // `categoryId` as a bare id into this store, so choosing a category by name is
  // a `like` query on this member, and the flag is also the server-side RSQL
  // allowlist marketplace-service checks before it will answer one.
  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-category.fields.name',
    required: true,
    filterable: true,
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

  // Retiring is not deleting: a specification in another slice's store holds a
  // bare `categoryId` and nothing enforces the reference, so removing the row
  // would leave every offering classified under it pointing at nothing.
  // `filterable` because the first thing an operator does on this screen is
  // narrow it to what is still active.
  @accessor({
    type: 'enum',
    label: 'Status',
    labelKey: 'entity:product-category.fields.status',
    enumValues: ReferenceStatuses,
    enumLabelKey: 'entity:reference-status',
    filterable: true,
  })
  get status(): ReferenceStatus {
    return this.#status;
  }
  set status(value: ReferenceStatus) {
    this.#status = value;
  }
  //#endregion
}
