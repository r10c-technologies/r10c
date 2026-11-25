import type { EntityRepositoryTag } from '@entifix/business';
import type {
  EntityMetadataSource,
  EntityUseCaseRunner,
  EntityWriter,
} from '@entifix/core';
import type {
  ImportCatalogPayload,
  ImportReferences,
} from '@r10c/business-ts-product-configuration-management';
import type { Context } from 'effect/Context';

/** A sheet's cells, the header row first, as the file holds them. */
export type ImportTable = readonly (readonly unknown[])[];

/** What became of a submitted import: its record, or the refusal's code. */
export type CatalogImportOutcome =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly code: string };

/**
 * The catalog import's browser half (ADR 0084): read a sheet, resolve its
 * names against the reference vocabulary, and submit the rows under the key
 * the wizard minted — so a resubmit after a lost answer resumes the import
 * rather than doubling it.
 */
export interface CatalogImportPort {
  /** The cells of a `.csv` or the first sheet of an `.xlsx`; fails on neither. */
  readTable(file: File): Promise<ImportTable>;
  /** Every active brand, category and phone model a sheet may name. */
  references(): Promise<ImportReferences>;
  submit(
    key: string,
    payload: ImportCatalogPayload,
  ): Promise<CatalogImportOutcome>;
}

export interface MarketplaceAdminAdapters {
  deviceModelWriter: EntityWriter;
  productBrandWriter: EntityWriter;
  productCategoryWriter: EntityWriter;
  productWriter: EntityWriter;
  productOfferingWriter: EntityWriter;
  productOfferingPriceWriter: EntityWriter;
  productCategoryRest: Context<EntityRepositoryTag>;
  deviceModelRest: Context<EntityRepositoryTag>;
  productBrandRest: Context<EntityRepositoryTag>;
  productRest: Context<EntityRepositoryTag>;
  productOfferingRest: Context<EntityRepositoryTag>;
  productOfferingPriceRest: Context<EntityRepositoryTag>;
  /** What each catalog import did: read-only. */
  catalogImportRest: Context<EntityRepositoryTag>;
  catalogImport: CatalogImportPort;
  /** The sellers' names, from marketplace-service's projection. Read-only. */
  publishedVendorRest: Context<EntityRepositoryTag>;
  /** The reference vocabulary's served affordances, through `/api/marketplace`. */
  referenceMetadata: EntityMetadataSource;
  /** The catalog service's served affordances, through `/api/admin`. */
  catalogMetadata: EntityMetadataSource;
  /** Each entity's verbs, posted to the path its service derives from the key. */
  deviceModelUseCases: EntityUseCaseRunner;
  productBrandUseCases: EntityUseCaseRunner;
  productCategoryUseCases: EntityUseCaseRunner;
  productOfferingUseCases: EntityUseCaseRunner;
  /** A price's verb: `set-price-tiers` (ADR 0082 §8). */
  productOfferingPriceUseCases: EntityUseCaseRunner;
  /** A product version's lifecycle verbs: release, revise, retire, obsolete. */
  productUseCases: EntityUseCaseRunner;
}
