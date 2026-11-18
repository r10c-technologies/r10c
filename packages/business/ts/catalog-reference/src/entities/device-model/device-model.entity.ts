import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import {
  DEFAULT_REFERENCE_STATUS,
  type ReferenceStatus,
  ReferenceStatuses,
} from '../../values/reference-status';

/**
 * A phone a product can fit — "Samsung Galaxy A15" — so a case, a screen
 * protector or a charger can say which phones it is for, and a buyer can filter
 * the storefront by their own (plan 1.17, r10c #641).
 *
 * **Operator-authored, in the shared vocabulary**, beside brand and category:
 * two vendors selling cases for the same phone must name the same row, or the
 * storefront's filter splits one phone into as many spellings as there are
 * sellers. A vendor's specification holds the ids in
 * `ProductSpecification.fitsDeviceModelIds`; "fits every phone" is the reserved
 * id `universal` there, never a row here, so nobody can retire it.
 *
 * Deliberately small: a maker and a full commercial name. A year or a product
 * line would each cost a field in two locales and nothing yet asks for them.
 */
@entity({
  labelMember: 'name',
  domain: 'catalog-reference',
  key: 'device-model',
  labelKey: 'entity:device-model.label',
  pluralKey: 'entity:device-model.plural',
})
export class DeviceModel implements Entity {
  // #region properties
  #id?: EntityId;
  #code?: string;
  #name: string;
  #maker?: string;
  #status: ReferenceStatus = DEFAULT_REFERENCE_STATUS;
  #revision?: number;
  // #endregion

  // #region constructors
  constructor(name = '') {
    this.#name = name;
  }
  // #endregion

  // #region accessors
  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:device-model.fields.id',
    // `filterable` because a reference names this record by `id=in=(…)`
    // (entifix 0030): member metadata is the server-side query allowlist.
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
    labelKey: 'entity:device-model.fields.code',
    minWidth: 6,
  })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  // `filterable` for the reason `ProductBrand.name` gives: the vendor's picker
  // finds a model by a `like` query on this member, and the flag is the
  // server-side allowlist, so losing it reads as "there are no models".
  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:device-model.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  // Filterable and sortable so the operator can read the list a maker at a time.
  @accessor({
    type: 'string',
    label: 'Maker',
    labelKey: 'entity:device-model.fields.maker',
    filterable: true,
    minWidth: 6,
  })
  get maker(): string | undefined {
    return this.#maker;
  }
  set maker(value: string | undefined) {
    this.#maker = value;
  }

  // Retired rather than deleted, for the reason `ProductBrand.status` gives: a
  // specification in another slice's store holds the bare id.
  @accessor({
    type: 'enum',
    label: 'Status',
    labelKey: 'entity:device-model.fields.status',
    minWidth: 6,
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

  // The revision check (ADR 0079 §4, entifix 0032), as on every authored record.
  @accessor({ type: 'revision', label: 'Revision' })
  get revision(): number | undefined {
    return this.#revision;
  }
  set revision(value: number | undefined) {
    this.#revision = value;
  }
  // #endregion
}
