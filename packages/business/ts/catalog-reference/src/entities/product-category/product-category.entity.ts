import type { Entity, EntityId, LocalizedText } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import {
  DEFAULT_REFERENCE_STATUS,
  type ReferenceStatus,
  ReferenceStatuses,
} from '../../values/reference-status';

@entity({
  labelMember: 'name',
  domain: 'catalog-reference',
  key: 'product-category',
  labelKey: 'entity:product-category.label',
  pluralKey: 'entity:product-category.plural',
})
export class ProductCategory implements Entity {
  //#region properties
  #id?: EntityId;
  #code: string;
  #name: LocalizedText;
  #description?: LocalizedText;
  #status: ReferenceStatus = DEFAULT_REFERENCE_STATUS;
  #parentId?: string;
  #revision?: number;
  //#endregion

  //#region constructors
  constructor(code = '', name: LocalizedText = {}) {
    this.#code = code;
    this.#name = name;
  }
  //#endregion

  //#region methods

  //#endregion

  //#region accessors
  // `filterable` so a parent picker can leave a category's own subtree out
  // with `id=out=(…)`: member metadata is the server-side query allowlist.
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-category.fields.id',
    filterable: true,
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

  // Written per locale (#573): a category's name reaches the storefront's nav,
  // crumbs, facets and titles, and one plain string is wrong for half the
  // buyers. Declared filterable and sortable for the same reason as
  // `ProductBrand.name` — a specification holds `categoryId` as a bare id into
  // this store, so choosing a category by name is a `like` query — but a
  // localized member is queried one locale at a time, as `name.<locale>`, and
  // the bare `name` is refused (entifix ADR 0005).
  @accessor({
    type: 'localized',
    label: 'Name',
    labelKey: 'entity:product-category.fields.name',
    required: true,
    filterable: true,
    sortable: true,
  })
  get name(): LocalizedText {
    return this.#name;
  }
  set name(value: LocalizedText) {
    this.#name = value;
  }

  // Per locale for the same reason as `name` (#572), and never queried: no
  // read filters or sorts on it.
  @accessor({
    type: 'localized',
    label: 'Description',
    labelKey: 'entity:product-category.fields.description',
    filterable: false,
    sortable: false,
  })
  get description(): LocalizedText | undefined {
    return this.#description;
  }
  set description(value: LocalizedText | undefined) {
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

  // The category this one sits under, absent for a root
  // ([ADR 0062](../../../../../../../docs/adr/0062-categories-form-a-tree.md)).
  // A same-store id rather than a link: the tree is always built from the
  // whole vocabulary, never by resolving one parent at a time. Not `hidden`
  // and not `readonly`: either keeps it off the wire, and the tree would reach
  // the storefront flat.
  @accessor({
    type: 'string',
    label: 'Parent',
    labelKey: 'entity:product-category.fields.parentId',
    parent: true,
    filterable: true,
  })
  get parentId(): string | undefined {
    return this.#parentId;
  }
  set parentId(value: string | undefined) {
    this.#parentId = value;
  }

  // The revision check (ADR 0079 §4, entifix 0032): an authored record states
  // the revision it read and a save is conditional on it. Server-owned but
  // client-visible, so neither `readonly` nor `hidden`; it presents as nothing.
  @accessor({ type: 'revision', label: 'Revision' })
  get revision(): number | undefined {
    return this.#revision;
  }
  set revision(value: number | undefined) {
    this.#revision = value;
  }
  //#endregion
}
