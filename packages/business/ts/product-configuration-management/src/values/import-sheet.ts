import { Failure, foldText, type Locale, parseScaled } from '@entifix/core';
import {
  deviceModelFitRefusal,
  mediaRefusal,
  UNIVERSAL_DEVICE_MODEL,
} from '@r10c/business-ts-catalog-contracts';
import {
  DEFAULT_PRICE_PER,
  DEFAULT_SALE_UNIT,
  isPricePer,
  isSaleUnit,
  isSellableRule,
  oneWholeUnit,
  parseQuantity,
  type PriceTier,
  priceTiersRefusal,
  type SaleUnit,
} from '@r10c/business-ts-sales-vocabulary';
import { Schema } from 'effect';

import { isSku, normalizedSku, SKU_INVALID } from './sku';

/**
 * The sheet a catalog import reads, column by column
 * ([ADR 0084](../../../../../../docs/adr/0084-a-catalog-import-is-a-record-and-a-row-is-one-unit-of-work.md)).
 *
 * Pure and framework-free, because it runs twice: in the browser, where the
 * preview shows each row's problems before anything is sent, and on the
 * service, which never trusts that preview and asks {@link importRowRefusal}
 * the same question again.
 */
export const IMPORT_COLUMNS = [
  'sku',
  'name',
  'description',
  'brand',
  'category',
  'fits',
  'image',
  'price',
  'currency',
  'pricePer',
  'unit',
  'step',
  'minimum',
  'tiers',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** A sheet with neither of these has nothing to import. */
export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = [
  'name',
  'price',
];

/**
 * Each column's header, per locale. A header is matched accent- and
 * case-blind against **every** locale's and the column's own key, so a sheet
 * written in English imports on a Spanish screen.
 *
 * The headers are data rather than catalog copy: they are what a file says,
 * and the template is written from this table, so a template downloaded in
 * one locale is read back in every other.
 */
export const IMPORT_HEADERS: Readonly<
  Record<'es' | 'en', Readonly<Record<ImportColumn, string>>>
> = {
  es: {
    sku: 'SKU',
    name: 'Nombre',
    description: 'Descripción',
    brand: 'Marca',
    category: 'Categoría',
    fits: 'Compatible con',
    image: 'Imagen (URL)',
    price: 'Precio',
    currency: 'Moneda',
    pricePer: 'Precio por',
    unit: 'Unidad',
    step: 'Paso',
    minimum: 'Mínimo',
    tiers: 'Escalas',
  },
  en: {
    sku: 'SKU',
    name: 'Name',
    description: 'Description',
    brand: 'Brand',
    category: 'Category',
    fits: 'Fits',
    image: 'Image (URL)',
    price: 'Price',
    currency: 'Currency',
    pricePer: 'Price per',
    unit: 'Unit',
    step: 'Step',
    minimum: 'Minimum',
    tiers: 'Tiers',
  },
};

/**
 * What an import refuses a row or a sheet with that no save does. Each is a
 * registered failure, so its `code` is an `errors` catalog key the i18n gate
 * holds to a sentence; a refused row carries the code on the import's record.
 */
export const IMPORT_COLUMN_UNKNOWN = 'importColumnUnknown';
export const IMPORT_COLUMN_MISSING = 'importColumnMissing';
export const IMPORT_CELL_INVALID = 'importCellInvalid';
export const IMPORT_REFERENCE_UNRESOLVED = 'importReferenceUnresolved';
export const IMPORT_DUPLICATE = 'importDuplicate';
export const IMPORT_EMPTY = 'importEmpty';
export const IMPORT_SPECIFICATION_CHANGED = 'importSpecificationChanged';

const where = {
  rowNumber: Schema.Number,
  column: Schema.optional(Schema.String),
};

/** A header the template does not have. */
export class ImportColumnUnknown extends Failure.invalid<ImportColumnUnknown>()(
  'ImportColumnUnknown',
  IMPORT_COLUMN_UNKNOWN,
  where,
  { message: () => 'the sheet has a column the template does not' },
) {}

/** A column every product needs, missing from the sheet. */
export class ImportColumnMissing extends Failure.invalid<ImportColumnMissing>()(
  'ImportColumnMissing',
  IMPORT_COLUMN_MISSING,
  where,
  { message: ({ column }) => `the sheet has no '${String(column)}' column` },
) {}

/** A cell that does not read as what its column holds. */
export class ImportCellInvalid extends Failure.invalid<ImportCellInvalid>()(
  'ImportCellInvalid',
  IMPORT_CELL_INVALID,
  where,
  {
    message: ({ rowNumber, column }) =>
      `row ${String(rowNumber)}: '${String(column)}' cannot be read`,
  },
) {}

/** A brand, category or model named by something no record is called. */
export class ImportReferenceUnresolved extends Failure.invalid<ImportReferenceUnresolved>()(
  'ImportReferenceUnresolved',
  IMPORT_REFERENCE_UNRESOLVED,
  where,
  {
    message: ({ rowNumber, column }) =>
      `row ${String(rowNumber)}: '${String(column)}' names nothing in the catalog`,
  },
) {}

/**
 * A new product the sheet or the catalog already has by its name, or a SKU an
 * earlier row of the sheet already used: one row creates or changes one
 * product, and two rows for one product say one thing twice.
 */
export class ImportDuplicate extends Failure.conflict<ImportDuplicate>()(
  'ImportDuplicate',
  IMPORT_DUPLICATE,
  where,
  {
    message: ({ rowNumber, column }) =>
      `row ${String(rowNumber)}: another product already has this ${String(column)}`,
  },
) {}

/**
 * A row naming a product by its SKU whose description, brand, category,
 * fit or picture differs from the product's. Those are the specification's,
 * changed by revising it; a sheet changes an offering's price and sale terms.
 */
export class ImportSpecificationChanged extends Failure.conflict<ImportSpecificationChanged>()(
  'ImportSpecificationChanged',
  IMPORT_SPECIFICATION_CHANGED,
  where,
  {
    message: ({ rowNumber, column }) =>
      `row ${String(rowNumber)}: '${String(column)}' differs from the product's, which only a revision changes`,
  },
) {}

/** A sheet with headers and no product under them. */
export class ImportEmpty extends Failure.invalid<ImportEmpty>()(
  'ImportEmpty',
  IMPORT_EMPTY,
  where,
  { message: () => 'the sheet has no products' },
) {}

/** The codes the domain's own save rules refuse a row with. */
export const SALE_RULE_INVALID = 'saleRuleInvalid';
const PRICE_PER_INVALID = 'pricePerInvalid';
export const PRICE_TIERS_INVALID = 'priceTiersInvalid';

/** Why one row, or the sheet as a whole (`rowNumber` 1), cannot be imported. */
export interface ImportProblem {
  /** As the sheet shows it: the header is row 1, the first product row 2. */
  readonly rowNumber: number;
  readonly code: string;
  readonly column?: ImportColumn;
}

/**
 * One row as the service receives it: every reference already an id, every
 * amount and quantity already a scaled integer. The browser resolved the
 * names; the service checks the rest again.
 */
/**
 * The sale-term columns a row may leave empty, which reading fills with a
 * default for a new product.
 */
export const DEFAULTED_IMPORT_COLUMNS = [
  'unit',
  'pricePer',
  'step',
  'minimum',
  'tiers',
] as const satisfies readonly ImportColumn[];

export type DefaultedImportColumn = (typeof DEFAULTED_IMPORT_COLUMNS)[number];

export interface ImportRow {
  readonly rowNumber: number;
  /**
   * The vendor's code: a SKU the catalog already holds names the offering
   * the row updates; a new one, or none, creates a product.
   */
  readonly sku?: string;
  readonly name: string;
  readonly description?: string;
  readonly brandId?: string;
  readonly categoryId?: string;
  readonly fitsDeviceModelIds?: readonly string[];
  readonly imageUrl?: string;
  /** Minor units of `currency`. */
  readonly amount: number;
  readonly currency: string;
  readonly pricePer: number;
  readonly saleUnit: string;
  /** In the unit's scale. */
  readonly quantityStep: number;
  readonly quantityMinimum: number;
  readonly tiers?: readonly PriceTier[];
  /**
   * The sale-term cells the sheet left empty, read as their default. A new
   * product takes the default; a product the row's SKU names keeps what it
   * has, so a sheet of prices alone changes prices alone (ADR 0084 §8).
   */
  readonly defaulted?: readonly DefaultedImportColumn[];
}

/** One row of the sheet, its cells keyed by column, before anything is read. */
export interface ImportSheetRow {
  readonly rowNumber: number;
  readonly cells: Readonly<Partial<Record<ImportColumn, string>>>;
}

/** A name a sheet may cite, and the id it stands for. */
export interface ImportReference {
  readonly id: string;
  readonly name: string;
}

/** What the sheet's names are resolved against. */
export interface ImportReferences {
  readonly brands: readonly ImportReference[];
  readonly categories: readonly ImportReference[];
  readonly deviceModels: readonly ImportReference[];
}

const cellText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/** Every spelling a column's header may take, folded. */
const HEADER_COLUMNS: ReadonlyMap<string, ImportColumn> = new Map(
  IMPORT_COLUMNS.flatMap(column => [
    [foldText(column), column] as const,
    ...Object.values(IMPORT_HEADERS).map(
      headers => [foldText(headers[column]), column] as const,
    ),
  ]),
);

/**
 * The sheet's rows by column, and what keeps the sheet as a whole from being
 * read: an unknown header, or a required column missing. Empty rows are
 * dropped; a row keeps the number the sheet showed it at.
 */
export const readImportSheet = (
  table: readonly (readonly unknown[])[],
): {
  readonly rows: readonly ImportSheetRow[];
  readonly problems: readonly ImportProblem[];
} => {
  const [header = [], ...body] = table;
  const problems: ImportProblem[] = [];
  const columns = header.map(cell => {
    const text = cellText(cell);
    if (text === '') return undefined;
    const column = HEADER_COLUMNS.get(foldText(text));
    if (column === undefined)
      problems.push({ rowNumber: 1, code: IMPORT_COLUMN_UNKNOWN });
    return column;
  });
  for (const required of REQUIRED_IMPORT_COLUMNS) {
    if (!columns.includes(required))
      problems.push({
        rowNumber: 1,
        code: IMPORT_COLUMN_MISSING,
        column: required,
      });
  }
  const rows: ImportSheetRow[] = [];
  for (const [index, line] of body.entries()) {
    const cells: Partial<Record<ImportColumn, string>> = {};
    for (const [position, column] of columns.entries()) {
      const text = cellText(line[position]);
      if (column !== undefined && text !== '') cells[column] = text;
    }
    if (Object.keys(cells).length > 0)
      rows.push({ rowNumber: index + 2, cells });
  }
  if (problems.length === 0 && rows.length === 0)
    problems.push({ rowNumber: 1, code: IMPORT_EMPTY });
  return { rows, problems };
};

/** The ISO 4217 codes this runtime knows, read once. */
const KNOWN_CURRENCIES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf('currency'),
);

/**
 * How many decimals a currency's minor unit holds, as `Intl` knows it — two
 * for GTQ and USD, none for JPY — so a price is never scaled by a guess. A
 * code `Intl` does not list is no currency: `GTO` for `GTQ` is a typo a
 * vendor should be told about, not a currency to store.
 */
export const minorUnitDigits = (currency: string): number | undefined =>
  KNOWN_CURRENCIES.has(currency)
    ? new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits
    : undefined;

/** A row that could not be read, carrying where. */
class RowUnreadable {
  constructor(
    readonly code: string,
    readonly column: ImportColumn,
  ) {}
}

const resolveName = (
  references: readonly ImportReference[],
  name: string,
  column: ImportColumn,
): string => {
  const folded = foldText(name);
  const found = references.find(
    reference => foldText(reference.name) === folded,
  );
  if (found === undefined)
    throw new RowUnreadable(IMPORT_REFERENCE_UNRESOLVED, column);
  return found.id;
};

/** `universal`, in either locale, stands for the reserved id rather than a model. */
const UNIVERSAL_NAMES = new Set(['universal', 'todos', 'all'].map(foldText));

const resolveFits = (
  references: readonly ImportReference[],
  text: string,
): readonly string[] =>
  text
    .split(/[;\n]/)
    .map(name => name.trim())
    .filter(name => name !== '')
    .map(name =>
      UNIVERSAL_NAMES.has(foldText(name))
        ? UNIVERSAL_DEVICE_MODEL
        : resolveName(references, name, 'fits'),
    );

const quantityIn = (
  text: string | undefined,
  unit: SaleUnit,
  locale: Locale,
  column: ImportColumn,
  fallback: number,
): number => {
  if (text === undefined) return fallback;
  const quantity = parseQuantity(text, unit, locale);
  if (quantity === undefined || quantity <= 0)
    throw new RowUnreadable(IMPORT_CELL_INVALID, column);
  return quantity;
};

const moneyIn = (
  text: string,
  digits: number,
  locale: Locale,
  column: ImportColumn,
): number => {
  const amount = parseScaled(text, digits, locale);
  if (amount === undefined || amount < 0)
    throw new RowUnreadable(IMPORT_CELL_INVALID, column);
  return amount;
};

/**
 * `10=11.50; 50=10.00` — from each quantity on, the line is charged that
 * price. The quantity is in the row's unit and the price in its currency, as
 * the sheet's own price column is.
 */
const tiersIn = (
  text: string,
  unit: SaleUnit,
  digits: number,
  locale: Locale,
): readonly PriceTier[] =>
  text
    .split(';')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .map(entry => {
      const [from, amount, ...rest] = entry.split('=').map(part => part.trim());
      if (from === undefined || amount === undefined || rest.length > 0)
        throw new RowUnreadable(IMPORT_CELL_INVALID, 'tiers');
      return {
        from: quantityIn(from, unit, locale, 'tiers', 0),
        amount: moneyIn(amount, digits, locale, 'tiers'),
      };
    });

const readRow = (
  row: ImportSheetRow,
  references: ImportReferences,
  locale: Locale,
  defaultCurrency: string,
): ImportRow => {
  const { cells } = row;
  const name = cells.name;
  if (name === undefined) throw new RowUnreadable(IMPORT_CELL_INVALID, 'name');

  const unitText = cells.unit?.toUpperCase() ?? DEFAULT_SALE_UNIT;
  if (!isSaleUnit(unitText))
    throw new RowUnreadable(IMPORT_CELL_INVALID, 'unit');
  const unit: SaleUnit = unitText;

  const currency = cells.currency?.toUpperCase() ?? defaultCurrency;
  const digits = minorUnitDigits(currency);
  if (digits === undefined)
    throw new RowUnreadable(IMPORT_CELL_INVALID, 'currency');

  const pricePer =
    cells.pricePer === undefined ? DEFAULT_PRICE_PER : Number(cells.pricePer);
  const step = quantityIn(cells.step, unit, locale, 'step', oneWholeUnit(unit));
  const image = cells.image;
  const sku = normalizedSku(cells.sku);
  const defaulted = DEFAULTED_IMPORT_COLUMNS.filter(
    column => cells[column] === undefined,
  );

  return {
    rowNumber: row.rowNumber,
    ...(sku === undefined ? {} : { sku }),
    name,
    ...(cells.description === undefined
      ? {}
      : { description: cells.description }),
    ...(cells.brand === undefined
      ? {}
      : { brandId: resolveName(references.brands, cells.brand, 'brand') }),
    ...(cells.category === undefined
      ? {}
      : {
          categoryId: resolveName(
            references.categories,
            cells.category,
            'category',
          ),
        }),
    ...(cells.fits === undefined
      ? {}
      : {
          fitsDeviceModelIds: resolveFits(references.deviceModels, cells.fits),
        }),
    ...(image === undefined ? {} : { imageUrl: image }),
    amount: moneyIn(cells.price ?? '', digits, locale, 'price'),
    currency,
    pricePer,
    saleUnit: unit,
    quantityStep: step,
    quantityMinimum: quantityIn(cells.minimum, unit, locale, 'minimum', step),
    ...(cells.tiers === undefined
      ? {}
      : { tiers: tiersIn(cells.tiers, unit, digits, locale) }),
    ...(defaulted.length === 0 ? {} : { defaulted }),
  };
};

/**
 * Why a row the sheet read cannot be imported, or `undefined` when it can —
 * the save rules a form would meet, asked of the row at once. The service runs
 * it again on every row it receives.
 */
export const importRowRefusal = (
  row: ImportRow,
): (ImportProblem & { readonly column: ImportColumn }) | undefined => {
  const at = (code: string, column: ImportColumn) => ({
    rowNumber: row.rowNumber,
    code,
    column,
  });
  if (row.sku !== undefined && !isSku(row.sku)) return at(SKU_INVALID, 'sku');
  if (row.name.trim() === '') return at(IMPORT_CELL_INVALID, 'name');
  if (!isSaleUnit(row.saleUnit)) return at(IMPORT_CELL_INVALID, 'unit');
  const digits = minorUnitDigits(row.currency);
  if (digits === undefined) return at(IMPORT_CELL_INVALID, 'currency');
  if (!Number.isSafeInteger(row.amount) || row.amount < 0)
    return at(IMPORT_CELL_INVALID, 'price');
  if (!isPricePer(row.pricePer)) return at(PRICE_PER_INVALID, 'pricePer');
  const rule = {
    saleUnit: row.saleUnit,
    quantityStep: row.quantityStep,
    quantityMinimum: row.quantityMinimum,
  };
  if (!isSellableRule(rule)) return at(SALE_RULE_INVALID, 'minimum');
  if (
    row.tiers !== undefined &&
    priceTiersRefusal(
      row.tiers,
      { amount: row.amount, pricePer: row.pricePer },
      rule,
    ) !== undefined
  )
    return at(PRICE_TIERS_INVALID, 'tiers');
  const fits = deviceModelFitRefusal(row.fitsDeviceModelIds);
  if (fits !== undefined) return at(fits, 'fits');
  const media = mediaRefusal(
    row.imageUrl === undefined
      ? undefined
      : [{ url: row.imageUrl, alt: row.name }],
  );
  if (media !== undefined) return at(media, 'image');
  return undefined;
};

/**
 * The sheet's rows as the service takes them, and every row's problem. A SKU
 * the sheet repeats is refused on every row after the first, and so is a name
 * repeated among rows with no SKU: one row creates or changes one product, and
 * two rows for one product is a sheet that says one thing twice.
 */
export const toImportRows = (
  sheet: readonly ImportSheetRow[],
  references: ImportReferences,
  options: { readonly locale: Locale; readonly defaultCurrency: string },
): {
  readonly rows: readonly ImportRow[];
  readonly problems: readonly ImportProblem[];
} => {
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const seen = new Set<string>();
  const seenSkus = new Set<string>();
  for (const sheetRow of sheet) {
    let row: ImportRow;
    try {
      row = readRow(
        sheetRow,
        references,
        options.locale,
        options.defaultCurrency,
      );
    } catch (error) {
      if (!(error instanceof RowUnreadable)) throw error;
      problems.push({
        rowNumber: sheetRow.rowNumber,
        code: error.code,
        column: error.column,
      });
      continue;
    }
    const refused = importRowRefusal(row);
    if (refused !== undefined) {
      problems.push(refused);
      continue;
    }
    if (row.sku !== undefined) {
      if (seenSkus.has(row.sku)) {
        problems.push({
          rowNumber: row.rowNumber,
          code: IMPORT_DUPLICATE,
          column: 'sku',
        });
        continue;
      }
      seenSkus.add(row.sku);
      rows.push(row);
      continue;
    }
    const folded = foldText(row.name);
    if (seen.has(folded)) {
      problems.push({
        rowNumber: row.rowNumber,
        code: IMPORT_DUPLICATE,
        column: 'name',
      });
      continue;
    }
    seen.add(folded);
    rows.push(row);
  }
  return { rows, problems };
};

/**
 * The template a vendor fills in: the header row in their locale and one
 * example row, as CSV. Written from {@link IMPORT_HEADERS}, so it always
 * reads back.
 */
export const importTemplateCsv = (locale: 'es' | 'en'): string => {
  const headers = IMPORT_HEADERS[locale];
  const example: Readonly<Record<ImportColumn, string>> = {
    sku: 'TOR-14',
    name: locale === 'es' ? 'Tornillo 1/4"' : 'Screw 1/4"',
    description: '',
    brand: '',
    category: '',
    fits: '',
    image: '',
    price: '1.50',
    currency: 'GTQ',
    pricePer: '1',
    unit: 'UN',
    step: '1',
    minimum: '1',
    tiers: '100=1.25; 500=1.10',
  };
  const quote = (value: string) =>
    /[",\n;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const line = (values: readonly string[]) => values.map(quote).join(',');
  return `${line(IMPORT_COLUMNS.map(column => headers[column]))}\n${line(
    IMPORT_COLUMNS.map(column => example[column]),
  )}\n`;
};
