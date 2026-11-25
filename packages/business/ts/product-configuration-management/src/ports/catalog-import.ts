import type { Invalid, StoreFailure } from '@entifix/core';
import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Context, type Effect } from 'effect';

import type { CatalogImport } from '../entities/catalog-import';
import type { ProductOffering } from '../entities/product-offering';
import type { ProductOfferingPrice } from '../entities/product-offering-price';
import type { ProductSpecification } from '../entities/product-specification';

/** One row's records, decided by the domain and written by the store as one. */
export interface ImportedRow {
  readonly specification: ProductSpecification;
  readonly offering: ProductOffering;
  readonly price: ProductOfferingPrice;
  /**
   * Run inside the unit, **after** the store has drawn the specification's
   * code: a release hashes content the code is part of, and a publication
   * copies it. Answers what to announce, or nothing for a draft.
   */
  readonly seal: (
    specification: ProductSpecification,
  ) => Effect.Effect<CatalogEvent | undefined>;
}

/** What became of a row: written now, or written by an earlier attempt. */
export interface ImportedRowOutcome {
  readonly outcome: 'created' | 'replayed';
  readonly specificationId: string;
  readonly offeringId: string;
}

/**
 * The `catalog` store's writes for a catalog import
 * ([ADR 0084](../../../../../../docs/adr/0084-a-catalog-import-is-a-record-and-a-row-is-one-unit-of-work.md)).
 *
 * ⚠️ **A row is one unit of work, claimed by `key`.** The specification (its
 * code drawn from the same counter a create draws from), the offering and the
 * price commit together with the announcement, or none of them does: a sheet
 * is never left with a product that has no offering. A second attempt with the
 * same key — a resubmitted sheet, a retry after the service fell over halfway —
 * answers `replayed` with the ids the first attempt wrote, and writes nothing.
 */
export interface CatalogImportCommands {
  /**
   * What an earlier attempt wrote under `key`, or nothing. Read before a row's
   * duplicate check, so a retried sheet is not refused for the products its
   * first attempt created.
   */
  readonly claimed: (
    organizationId: string,
    key: string,
  ) => Effect.Effect<ImportedRowOutcome | undefined, StoreFailure | Invalid>;
  readonly importRow: (
    organizationId: string,
    key: string,
    row: ImportedRow,
  ) => Effect.Effect<ImportedRowOutcome, StoreFailure | Invalid>;
  /**
   * Write the import's record under its id, once: an id already written
   * answers the record that is stored, so two attempts report one outcome.
   */
  readonly record: (
    organizationId: string,
    catalogImport: CatalogImport,
  ) => Effect.Effect<CatalogImport, StoreFailure | Invalid>;
}

export class CatalogImportCommandsTag extends Context.Service<
  CatalogImportCommandsTag,
  CatalogImportCommands
>()('CatalogImportCommandsTag') {}

/**
 * How many rows one import takes — `catalog.importMaxRows`, read from
 * configuration by the slice shell and handed to the route.
 */
export class CatalogImportLimitTag extends Context.Service<
  CatalogImportLimitTag,
  { readonly maxRows: number }
>()('CatalogImportLimitTag') {}
