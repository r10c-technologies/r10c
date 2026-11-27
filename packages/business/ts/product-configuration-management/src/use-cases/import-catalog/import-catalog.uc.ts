import { permissionForUseCase } from '@entifix/authz';
import { EntityRepositoryFactoryTag } from '@entifix/business';
import { Failure, useCase } from '@entifix/core';
import {
  catalogPublishedEvent,
  MediaReference,
} from '@r10c/business-ts-catalog-contracts';
import type { PricePer, SaleUnit } from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import type { ImportRejection } from '../../entities/catalog-import';
import { CatalogImport } from '../../entities/catalog-import';
import { ProductOffering } from '../../entities/product-offering';
import { ProductOfferingPrice } from '../../entities/product-offering-price';
import { ProductSpecification } from '../../entities/product-specification';
import {
  CatalogImportCommandsTag,
  type ImportedRowOutcome,
  type UpdatedRow,
} from '../../ports/catalog-import';
import {
  type CatalogImportMode,
  CatalogImportModes,
} from '../../values/catalog-import-status';
import {
  IMPORT_DUPLICATE,
  IMPORT_SPECIFICATION_CHANGED,
  type ImportColumn,
  type ImportRow,
  importRowRefusal,
} from '../../values/import-sheet';
import { contentHashOf } from '../../values/specification-lifecycle';
import { startSpecificationSeries } from '../specification-lifecycle/specification-flows';
import {
  kitStockOfOffering,
  offeringPublication,
  stockSourceOf,
} from '../transition-offering/transition-offering';

/** One row on the wire: what `toImportRows` answered in the browser. */
export const ImportRowSchema = Schema.Struct({
  rowNumber: Schema.Int,
  sku: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  brandId: Schema.optional(Schema.String),
  categoryId: Schema.optional(Schema.String),
  fitsDeviceModelIds: Schema.optional(Schema.Array(Schema.String)),
  imageUrl: Schema.optional(Schema.String),
  amount: Schema.Int,
  currency: Schema.String,
  pricePer: Schema.Int,
  saleUnit: Schema.String,
  quantityStep: Schema.Int,
  quantityMinimum: Schema.Int,
  tiers: Schema.optional(
    Schema.Array(Schema.Struct({ from: Schema.Int, amount: Schema.Int })),
  ),
});

/** What `import` accepts: the file's name for the record, how, and the rows. */
export const ImportCatalogPayload = Schema.Struct({
  fileName: Schema.String,
  mode: Schema.Literals(CatalogImportModes),
  rows: Schema.Array(ImportRowSchema),
});

export type ImportCatalogPayload = typeof ImportCatalogPayload.Type;

export const IMPORT_TOO_LARGE = 'importTooLarge';

/**
 * A sheet past the rows one request takes. Refused whole, before any row is
 * written: half a sheet imported because the rest did not fit is a catalog
 * nobody can reason about.
 */
export class ImportTooLarge extends Failure.invalid<ImportTooLarge>()(
  'ImportTooLarge',
  IMPORT_TOO_LARGE,
  { rows: Schema.Number, max: Schema.Number },
  {
    message: ({ rows, max }) =>
      `an import takes at most ${String(max)} rows; this one has ${String(rows)}`,
  },
) {}

/** Everything an import is run with that is not in its body. */
export interface ImportCatalogInput {
  readonly organizationId: string;
  /**
   * The request's `Idempotency-Key`: the import's id, and with each row's
   * number the claim that row is written under.
   */
  readonly key: string;
  /** The emitting slice, for a publication's `source`. */
  readonly source: string;
  readonly at: Date;
  /** `catalog.importMaxRows`, read by the shell from configuration. */
  readonly maxRows: number;
  readonly payload: ImportCatalogPayload;
}

/** The records one row stands for, before the store numbers them. */
const recordsOf = (row: ImportRow, mode: CatalogImportMode, at: Date) => {
  const specification = startSpecificationSeries(
    new ProductSpecification('', row.name),
  );
  specification.id = globalThis.crypto.randomUUID();
  specification.description = row.description;
  specification.brandId = row.brandId;
  specification.categoryId = row.categoryId;
  specification.fitsDeviceModelIds = row.fitsDeviceModelIds;
  specification.media =
    row.imageUrl === undefined
      ? undefined
      : [new MediaReference(row.imageUrl, row.name)];

  const offering = new ProductOffering(row.name, String(specification.id));
  offering.id = globalThis.crypto.randomUUID();
  offering.sku = row.sku;
  // Checked by `importRowRefusal` before this is reached.
  offering.saleUnit = row.saleUnit as SaleUnit;
  offering.quantityStep = row.quantityStep;
  offering.quantityMinimum = row.quantityMinimum;
  offering.revision = 1;

  const price = new ProductOfferingPrice(
    String(offering.id),
    row.amount,
    row.currency,
  );
  price.id = globalThis.crypto.randomUUID();
  price.pricePer = row.pricePer as PricePer;
  price.tiers =
    row.tiers === undefined || row.tiers.length === 0
      ? undefined
      : row.tiers.map(({ from, amount }) => ({ from, amount }));
  price.revision = 1;

  if (mode === 'publish') {
    // Released and on sale in the same write: the version the offering pins
    // is the series' first, and it is active from the moment it exists.
    specification.lifecycleStatus = 'active';
    specification.validFrom = at;
    offering.status = 'published';
    offering.statusChangedAt = at;
  }
  return { specification, offering, price };
};

/** The domain's own codes, for a row refused as a save or a publication would be. */
const SALE_UNIT_FIXED = 'saleUnitFixed';
const SPECIFICATION_NOT_ACTIVE = 'specificationNotActive';
const STOCK_SOURCE_INVALID = 'stockSourceInvalid';
const KIT_INVALID = 'kitInvalid';
const STALE_REVISION = 'staleRevision';

/** Why a row may not change the offering its SKU names: a column and a code. */
interface UpdateRefusal {
  readonly code: string;
  readonly column: ImportColumn;
}

const sameIds = (
  given: readonly string[],
  held: readonly string[] | undefined,
) => [...given].sort().join('\n') === [...(held ?? [])].sort().join('\n');

/**
 * The first cell the row gives that differs from the product it names. A cell
 * left empty keeps what the product has, so a sheet of prices alone updates
 * prices; a merchandising cell that says something else is a revision of the
 * specification, which a sheet does not make (ADR 0084 §8).
 */
const merchandisingChange = (
  row: ImportRow,
  specification: ProductSpecification | undefined,
): ImportColumn | undefined => {
  if (
    row.description !== undefined &&
    row.description !== specification?.description
  )
    return 'description';
  if (row.brandId !== undefined && row.brandId !== specification?.brandId)
    return 'brand';
  if (
    row.categoryId !== undefined &&
    row.categoryId !== specification?.categoryId
  )
    return 'category';
  if (
    row.fitsDeviceModelIds !== undefined &&
    !sameIds(row.fitsDeviceModelIds, specification?.fitsDeviceModelIds)
  )
    return 'fits';
  if (
    row.imageUrl !== undefined &&
    !(specification?.media ?? []).some(({ url }) => url === row.imageUrl)
  )
    return 'image';
  return undefined;
};

/**
 * The offering and price a row changes them into, or why it may not. The unit
 * is never changed here, whatever the offering's standing: `set-sale-unit`
 * owns it, and a unit moved under stored quantities would change what each of
 * them means (ADR 0082 §8).
 */
const updatedRecordsOf = (
  row: ImportRow,
  offering: ProductOffering,
  price: ProductOfferingPrice | undefined,
  specification: ProductSpecification | undefined,
):
  | UpdateRefusal
  | { offering: ProductOffering; price: ProductOfferingPrice } => {
  if (row.saleUnit !== offering.saleUnit)
    return { code: SALE_UNIT_FIXED, column: 'unit' };
  const changed = merchandisingChange(row, specification);
  if (changed !== undefined)
    return { code: IMPORT_SPECIFICATION_CHANGED, column: changed };
  offering.name = row.name;
  offering.quantityStep = row.quantityStep;
  offering.quantityMinimum = row.quantityMinimum;
  const repriced =
    price ??
    Object.assign(new ProductOfferingPrice(String(offering.id)), {
      id: globalThis.crypto.randomUUID(),
    });
  repriced.amount = row.amount;
  repriced.currency = row.currency;
  repriced.pricePer = row.pricePer as PricePer;
  repriced.tiers =
    row.tiers === undefined || row.tiers.length === 0
      ? undefined
      : row.tiers.map(({ from, amount }) => ({ from, amount }));
  return { offering, price: repriced };
};

/**
 * Load a vendor's catalog from a sheet
 * ([ADR 0084](../../../../../../../docs/adr/0084-a-catalog-import-is-a-record-and-a-row-is-one-unit-of-work.md)):
 * each row a product, the way it is sold and its price — drafts, or released
 * and on sale.
 *
 * **Every row is asked what a form save would ask**, through the same pure
 * rules (`importRowRefusal`), whatever the browser's preview already said.
 * A refused row is reported on the import's record with its `errors` code
 * and never ends the run; a store that fails ends it, and resubmitting the
 * same sheet under the same key resumes where it stopped.
 *
 * **A SKU decides between a create and an update** (ADR 0084 §8). A row whose
 * SKU names an offering of the catalog changes that offering's name, sale
 * terms and price — and republishes it in the same unit when it is on sale,
 * checked as a publication is; a draft stays a draft. A row with a new SKU, or
 * none, creates a product, and is refused `importDuplicate` when one of the
 * same name is in design or on sale: which of two same-named products a sheet
 * means is not something to guess. Two imports racing on one new name are not
 * caught here — exactly as two people creating it through the form are not;
 * two racing on one new SKU are, by the store.
 *
 * `unbound`: it acts on no record and no selection, and the back office
 * reaches it only through its wizard (`form`), never as a toolbar button.
 */
@useCase({
  entity: CatalogImport,
  key: 'import',
  binding: 'unbound',
  placement: 'context-independent',
  labelKey: 'entity:catalog-import.useCases.import',
  payload: ImportCatalogPayload,
  form: 'catalog-import',
  errors: [ImportTooLarge],
})
export class ImportCatalogUC {
  static run(input: ImportCatalogInput) {
    return Effect.gen(function* () {
      const { organizationId, key, at, payload } = input;
      if (payload.rows.length > input.maxRows) {
        return yield* new ImportTooLarge({
          rows: payload.rows.length,
          max: input.maxRows,
        });
      }

      const commands = yield* CatalogImportCommandsTag;
      const factory = yield* EntityRepositoryFactoryTag;
      const specifications = yield* factory.for(ProductSpecification, {
        organizationId,
      });
      const offerings = yield* factory.for(ProductOffering, { organizationId });
      const prices = yield* factory.for(ProductOfferingPrice, {
        organizationId,
      });

      /**
       * What an update row writes, or why it may not: the records it changes
       * and, for an offering on sale, the republication — checked exactly as
       * `publish` checks one, since the import announces it in its stead.
       */
      const updateOf = (row: ImportRow, offering: ProductOffering) =>
        Effect.gen(function* () {
          const [specification] =
            (yield* specifications.load<ProductSpecification>({
              filtering: [
                {
                  property: 'id',
                  operator: 'eq',
                  value: offering.specificationId,
                },
              ],
              pageSize: 1,
            })).items;
          const [price] = (yield* prices.load<ProductOfferingPrice>({
            filtering: [
              {
                property: 'offeringId',
                operator: 'eq',
                value: String(offering.id),
              },
            ],
            pageSize: 1,
          })).items;
          const records = updatedRecordsOf(row, offering, price, specification);
          if ('code' in records) return records;
          const base = { ...records, priceIsNew: price === undefined };
          if (offering.status !== 'published')
            return { ...base, event: undefined } satisfies UpdatedRow;
          if (specification?.lifecycleStatus !== 'active')
            return { code: SPECIFICATION_NOT_ACTIVE, column: 'sku' } as const;
          const stockSource = yield* stockSourceOf(offerings, offering);
          if (typeof stockSource === 'string')
            return { code: STOCK_SOURCE_INVALID, column: 'sku' } as const;
          const kit = yield* kitStockOfOffering(offerings, offering);
          if (typeof kit === 'string')
            return { code: KIT_INVALID, column: 'sku' } as const;
          offering.statusChangedAt = at;
          return {
            ...base,
            event: catalogPublishedEvent(
              offeringPublication({
                offering,
                specification,
                price: records.price,
                vendorId: organizationId,
                at,
                ...(stockSource === undefined ? {} : { stockSource }),
                ...(kit === undefined ? {} : { kitComponents: kit }),
              }),
              input.source,
            ),
          } satisfies UpdatedRow;
        });

      const rejections: ImportRejection[] = [];
      const written: ImportedRowOutcome[] = [];
      const reject = (rowNumber: number, code: string, column: string) => {
        rejections.push({ rowNumber, code, column });
      };

      for (const row of payload.rows) {
        const refused = importRowRefusal(row);
        if (refused !== undefined) {
          reject(refused.rowNumber, refused.code, refused.column);
          continue;
        }
        const rowKey = `${key}:${String(row.rowNumber)}`;
        const earlier = yield* commands.claimed(organizationId, rowKey);
        if (earlier !== undefined) {
          written.push(earlier);
          continue;
        }
        if (
          row.sku !== undefined &&
          payload.rows.some(
            other => other.rowNumber < row.rowNumber && other.sku === row.sku,
          )
        ) {
          reject(row.rowNumber, IMPORT_DUPLICATE, 'sku');
          continue;
        }
        const coded =
          row.sku === undefined
            ? undefined
            : (yield* offerings.load<ProductOffering>({
                filtering: [
                  { property: 'sku', operator: 'eq', value: row.sku },
                ],
                pageSize: 1,
              })).items[0];
        if (coded !== undefined) {
          const update = yield* updateOf(row, coded);
          if ('code' in update) {
            reject(row.rowNumber, update.code, update.column);
            continue;
          }
          const outcome = yield* commands.updateRow(
            organizationId,
            rowKey,
            update,
          );
          if (outcome !== 'changed') {
            written.push(outcome);
            continue;
          }
          // Another attempt at this sheet may have been the one to move it.
          const raced = yield* commands.claimed(organizationId, rowKey);
          if (raced !== undefined) written.push(raced);
          else reject(row.rowNumber, STALE_REVISION, 'sku');
          continue;
        }
        const named = yield* specifications.load<ProductSpecification>({
          filtering: [{ property: 'name', operator: 'eq', value: row.name }],
          pageSize: 10,
        });
        if (
          named.items.some(
            ({ lifecycleStatus }) =>
              lifecycleStatus === 'in-design' || lifecycleStatus === 'active',
          ) ||
          payload.rows.some(
            other =>
              other.rowNumber < row.rowNumber &&
              other.sku === undefined &&
              row.sku === undefined &&
              other.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
          )
        ) {
          // ⚠️ The product may be this very row, written by another attempt
          // at the same sheet between the claim read above and this one: its
          // claim commits with its records, so a product seen here has a
          // claim to be seen too. Measured — ten attempts at once refused
          // three rows of their own sheet as duplicates without this read.
          const raced = yield* commands.claimed(organizationId, rowKey);
          if (raced !== undefined) {
            written.push(raced);
            continue;
          }
          reject(row.rowNumber, IMPORT_DUPLICATE, 'name');
          continue;
        }

        const records = recordsOf(row, payload.mode, at);
        written.push(
          yield* commands.importRow(organizationId, rowKey, {
            ...records,
            seal: specification =>
              payload.mode === 'draft'
                ? Effect.succeed(undefined)
                : Effect.gen(function* () {
                    specification.contentHash =
                      yield* contentHashOf(specification);
                    return catalogPublishedEvent(
                      offeringPublication({
                        offering: records.offering,
                        specification,
                        price: records.price,
                        vendorId: organizationId,
                        at,
                      }),
                      input.source,
                    );
                  }),
          }),
        );
      }

      const record = new CatalogImport(payload.fileName);
      record.id = key;
      record.mode = payload.mode;
      record.importedAt = at;
      record.rowCount = payload.rows.length;
      record.createdCount = written.filter(
        ({ change }) => change === 'create',
      ).length;
      record.updatedCount = written.filter(
        ({ change }) => change === 'update',
      ).length;
      record.rejectedCount = rejections.length;
      record.rejections = rejections.length === 0 ? undefined : rejections;
      record.status = rejections.length === 0 ? 'completed' : 'partial';
      return yield* commands.record(organizationId, record);
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks it against the grant table.
 */
export const IMPORT_CATALOG = permissionForUseCase(ImportCatalogUC);
