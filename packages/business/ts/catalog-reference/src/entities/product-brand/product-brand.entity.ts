import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  DEFAULT_REFERENCE_STATUS,
  type ReferenceStatus,
  ReferenceStatuses,
} from '../../values/reference-status';

@entity({
  domain: 'catalog-reference',
  key: 'product-brand',
  labelKey: 'entity:product-brand.label',
  pluralKey: 'entity:product-brand.plural',
})
export class ProductBrand implements Entity {
  // #region properties
  #id?: EntityId;
  #code?: string;
  #name: string;
  #description?: string;
  #website?: string;
  #status: ReferenceStatus = DEFAULT_REFERENCE_STATUS;
  // #endregion

  // #region constructors
  constructor(name = '') {
    this.#name = name;
  }
  // #endregion

  // #region methods
  // #endregion

  // #region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-brand.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  // Assigned by the create transaction (`brand-001`, `brand-002`, …); optional
  // because a raw payload arrives without one.
  @accessor({
    type: 'string',
    label: 'Code',
    labelKey: 'entity:product-brand.fields.code',
  })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  // `filterable` is declared rather than inherited, because it is load-bearing
  // here and a scalar's default is easy to change without noticing. A vendor
  // classifying an offering holds `ProductSpecification.brandId` — a bare id into
  // this store, since a typed link across the slice boundary is not a legal edge
  // (ADR 0022) — so the only way to choose a brand by name is a `like` query on
  // this member. The flag is simultaneously the server-side RSQL allowlist, and
  // the failure is silent in both directions: the service answers `400`, and the
  // picker renders that as an empty suggestion list, which reads as "there are no
  // brands". Asserted in `catalog-reference-entities.spec.ts`.
  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-brand.fields.name',
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
    labelKey: 'entity:product-brand.fields.description',
  })
  get description(): string | undefined {
    return this.#description;
  }
  set description(value: string | undefined) {
    this.#description = value;
  }

  @accessor({
    type: 'string',
    label: 'Website',
    labelKey: 'entity:product-brand.fields.website',
  })
  get website(): string | undefined {
    return this.#website;
  }
  set website(value: string | undefined) {
    this.#website = value;
  }

  // Retiring is not deleting: a specification in another slice's store holds a
  // bare `brandId`/`categoryId` and nothing enforces the reference, so removing
  // the row would leave every offering classified under it pointing at nothing.
  // `filterable` because the first thing an operator does on this screen is
  // narrow it to what is still active.
  @accessor({
    type: 'enum',
    label: 'Status',
    labelKey: 'entity:product-brand.fields.status',
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
  // #endregion
}
