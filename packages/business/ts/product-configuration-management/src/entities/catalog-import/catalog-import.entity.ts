import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';

import {
  type CatalogImportMode,
  CatalogImportModes,
  type CatalogImportStatus,
  CatalogImportStatuses,
  CatalogImportStatusTones,
} from '../../values/catalog-import-status';
import {
  type ImportRejection,
  ImportRejectionRow,
} from './import-rejection-row';

/**
 * One bulk load of a vendor's catalog from a sheet, and what became of each
 * row ([ADR 0084](../../../../../../../docs/adr/0084-a-catalog-import-is-a-record-and-a-row-is-one-unit-of-work.md)).
 *
 * **A record, not a response.** The rows an import refused are the vendor's
 * to-do list, and a list that lived only in the answer to one request is gone
 * the moment the tab closes. Its id is the import's own `Idempotency-Key`, so a
 * resubmitted sheet finds this record instead of writing a second.
 *
 * Nothing here is authored: the import verb writes every member, and the
 * entity's routes are reads. That is why no member is `required` — a hidden
 * rule still runs (ADR 0047) — and none is `readonly`, which would drop it from
 * serialization both ways.
 *
 * The sheet itself is never stored: the browser parses it and sends rows, so
 * the record holds no file and needs no deletion date (contrast ADR 0081).
 *
 * Tenant plane, `catalog` store.
 */
@entity({
  labelMember: 'fileName',
  domain: 'product-configuration-management',
  key: 'catalog-import',
  labelKey: 'entity:catalog-import.label',
  pluralKey: 'entity:catalog-import.plural',
  // Only the import verb writes one: its routes serve reads, and no list of
  // it offers "New".
  creatable: false,
})
export class CatalogImport implements Entity {
  // #region properties
  #id?: EntityId;
  #fileName: string;
  #mode: CatalogImportMode = 'draft';
  #status: CatalogImportStatus = 'completed';
  #importedAt?: Date;
  #rowCount = 0;
  #createdCount = 0;
  #updatedCount = 0;
  #rejectedCount = 0;
  #rejections?: readonly ImportRejection[];
  // #endregion

  // #region constructors
  constructor(fileName = '') {
    this.#fileName = fileName;
  }
  // #endregion

  // #region accessors
  @accessor({ type: 'id', labelKey: 'entity:catalog-import.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:catalog-import.fields.fileName',
    sortable: true,
    filterable: true,
  })
  get fileName(): string {
    return this.#fileName;
  }
  set fileName(value: string) {
    this.#fileName = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:catalog-import.fields.mode',
    enumValues: CatalogImportModes,
    enumLabelKey: 'entity:catalog-import.values.mode',
    filterable: true,
  })
  get mode(): CatalogImportMode {
    return this.#mode;
  }
  set mode(value: CatalogImportMode) {
    this.#mode = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:catalog-import.fields.status',
    enumValues: CatalogImportStatuses,
    enumTones: CatalogImportStatusTones,
    enumLabelKey: 'entity:catalog-import.values.status',
    filterable: true,
  })
  get status(): CatalogImportStatus {
    return this.#status;
  }
  set status(value: CatalogImportStatus) {
    this.#status = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:catalog-import.fields.importedAt',
    sortable: true,
    filterable: true,
  })
  get importedAt(): Date | undefined {
    return this.#importedAt;
  }
  set importedAt(value: Date | undefined) {
    this.#importedAt = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:catalog-import.fields.rowCount',
    sortable: true,
  })
  get rowCount(): number {
    return this.#rowCount;
  }
  set rowCount(value: number) {
    this.#rowCount = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:catalog-import.fields.createdCount',
    sortable: true,
  })
  get createdCount(): number {
    return this.#createdCount;
  }
  set createdCount(value: number) {
    this.#createdCount = value;
  }

  /** Rows whose SKU named an offering the catalog held, and changed it. */
  @accessor({
    type: 'number',
    labelKey: 'entity:catalog-import.fields.updatedCount',
    sortable: true,
  })
  get updatedCount(): number {
    return this.#updatedCount;
  }
  set updatedCount(value: number) {
    this.#updatedCount = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:catalog-import.fields.rejectedCount',
    sortable: true,
  })
  get rejectedCount(): number {
    return this.#rejectedCount;
  }
  set rejectedCount(value: number) {
    this.#rejectedCount = value;
  }

  /** Absent, never `[]`, when every row was written. */
  @accessor({
    type: 'composition',
    childType: () => ImportRejectionRow,
    labelKey: 'entity:catalog-import.fields.rejections',
  })
  get rejections(): readonly ImportRejection[] | undefined {
    return this.#rejections;
  }
  set rejections(value: readonly ImportRejection[] | undefined) {
    this.#rejections = value;
  }
  // #endregion
}
