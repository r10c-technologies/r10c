import { describe, expect, it } from 'vitest';

import {
  IMPORT_COLUMNS,
  IMPORT_HEADERS,
  ImportCellInvalid,
  ImportColumnMissing,
  ImportColumnUnknown,
  ImportDuplicate,
  ImportEmpty,
  ImportReferenceUnresolved,
  type ImportRow,
  importRowRefusal,
  importTemplateCsv,
  minorUnitDigits,
  readImportSheet,
  toImportRows,
} from './import-sheet.js';

const references = {
  brands: [{ id: 'b-1', name: 'Truper' }],
  categories: [{ id: 'c-1', name: 'Tornillería' }],
  deviceModels: [
    { id: 'd-1', name: 'iPhone 15' },
    { id: 'd-2', name: 'Galaxy A15' },
  ],
};

const options = { locale: 'es', defaultCurrency: 'GTQ' } as const;

const read = (table: readonly (readonly unknown[])[]) => {
  const sheet = readImportSheet(table);
  return { sheet, ...toImportRows(sheet.rows, references, options) };
};

const valid: ImportRow = {
  rowNumber: 2,
  name: 'Tornillo',
  amount: 150,
  currency: 'GTQ',
  pricePer: 1,
  saleUnit: 'UN',
  quantityStep: 1,
  quantityMinimum: 1,
};

describe('reading the sheet', () => {
  it('matches headers in either locale, by key, blind to accents and case', () => {
    const { sheet } = read([
      ['NOMBRE', 'price', 'Categoria', 'Fits', ''],
      ['Tornillo', '1.50', 'tornilleria', 'iPhone 15', 'ignored'],
    ]);

    expect(sheet).toEqual({
      rows: [
        {
          rowNumber: 2,
          cells: {
            name: 'Tornillo',
            price: '1.50',
            category: 'tornilleria',
            fits: 'iPhone 15',
          },
        },
      ],
      problems: [],
    });
  });

  it('refuses an unknown header and a missing required column on row 1', () => {
    const { sheet } = read([
      ['Nombre', 'Color'],
      ['Tornillo', 'rojo'],
    ]);

    expect(sheet.problems).toEqual([
      { rowNumber: 1, code: 'importColumnUnknown' },
      { rowNumber: 1, code: 'importColumnMissing', column: 'price' },
    ]);
  });

  it('drops empty rows, keeping each row at the number the sheet shows', () => {
    const { sheet } = read([
      ['Nombre', 'Precio'],
      [null, undefined],
      ['  Tornillo ', 2],
    ]);

    expect(sheet.rows).toEqual([
      { rowNumber: 3, cells: { name: 'Tornillo', price: '2' } },
    ]);
  });

  it('calls a sheet with headers and no rows empty', () => {
    expect(readImportSheet([['Nombre', 'Precio']]).problems).toEqual([
      { rowNumber: 1, code: 'importEmpty' },
    ]);
    expect(readImportSheet([]).problems).toEqual([
      { rowNumber: 1, code: 'importColumnMissing', column: 'name' },
      { rowNumber: 1, code: 'importColumnMissing', column: 'price' },
    ]);
  });
});

describe('turning rows into what the service takes', () => {
  it('scales money and quantities, resolves names and defaults the rest', () => {
    const { rows, problems } = read([
      [
        'Nombre',
        'Descripción',
        'Marca',
        'Categoría',
        'Compatible con',
        'Imagen (URL)',
        'Precio',
        'Moneda',
        'Precio por',
        'Unidad',
        'Paso',
        'Mínimo',
        'Escalas',
      ],
      [
        'Cuero',
        'Vaqueta',
        'TRUPER',
        'Tornilleria',
        'iphone 15; Galaxy A15',
        'https://media.example.test/a.png',
        '120,50',
        'usd',
        '100',
        'm',
        '0,5',
        '1',
        '10=110; 20 = 100',
      ],
      ['Funda', '', '', '', 'Universal', '', '45', '', '', '', '', '', ''],
    ]);

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        rowNumber: 2,
        name: 'Cuero',
        description: 'Vaqueta',
        brandId: 'b-1',
        categoryId: 'c-1',
        fitsDeviceModelIds: ['d-1', 'd-2'],
        imageUrl: 'https://media.example.test/a.png',
        amount: 12050,
        currency: 'USD',
        pricePer: 100,
        saleUnit: 'M',
        quantityStep: 500,
        quantityMinimum: 1000,
        tiers: [
          { from: 10000, amount: 11000 },
          { from: 20000, amount: 10000 },
        ],
      },
      {
        rowNumber: 3,
        name: 'Funda',
        fitsDeviceModelIds: ['universal'],
        amount: 4500,
        currency: 'GTQ',
        pricePer: 1,
        saleUnit: 'UN',
        quantityStep: 1,
        quantityMinimum: 1,
      },
    ]);
  });

  it('names the cell that could not be read', () => {
    const header = [
      'Nombre',
      'Precio',
      'Marca',
      'Unidad',
      'Moneda',
      'Paso',
      'Escalas',
      'Descripción',
    ];
    const { rows, problems } = read([
      header,
      ['', '1', '', '', '', '', '', 'no name'],
      ['A', '1', 'Nadie', '', '', '', '', ''],
      ['B', '1', '', 'CAJA', '', '', '', ''],
      ['C', '1', '', '', 'XXX', '', '', ''],
      ['D', '1', '', '', 'GT', '', '', ''],
      ['E', 'gratis', '', '', '', '', '', ''],
      ['F', '-1', '', '', '', '', '', ''],
      ['G', '1', '', '', '', '0', '', ''],
      ['H', '1', '', '', '', 'x', '', ''],
      ['I', '1', '', '', '', '', '10', ''],
      ['J', '1', '', '', '', '', '10=1=2', ''],
      ['K', '1', '', '', '', '', '10=; ;', ''],
    ]);

    expect(rows).toEqual([]);
    expect(problems).toEqual([
      { rowNumber: 2, code: 'importCellInvalid', column: 'name' },
      { rowNumber: 3, code: 'importReferenceUnresolved', column: 'brand' },
      { rowNumber: 4, code: 'importCellInvalid', column: 'unit' },
      { rowNumber: 5, code: 'importCellInvalid', column: 'currency' },
      { rowNumber: 6, code: 'importCellInvalid', column: 'currency' },
      { rowNumber: 7, code: 'importCellInvalid', column: 'price' },
      { rowNumber: 8, code: 'importCellInvalid', column: 'price' },
      { rowNumber: 9, code: 'importCellInvalid', column: 'step' },
      { rowNumber: 10, code: 'importCellInvalid', column: 'step' },
      { rowNumber: 11, code: 'importCellInvalid', column: 'tiers' },
      { rowNumber: 12, code: 'importCellInvalid', column: 'tiers' },
      { rowNumber: 13, code: 'importCellInvalid', column: 'tiers' },
    ]);
  });

  it('resolves a category and a fitted model by name, or names the column', () => {
    const { problems } = read([
      ['Nombre', 'Precio', 'Categoría', 'Compatible con'],
      ['A', '1', 'Nada', ''],
      ['B', '1', '', 'Nokia 3310'],
    ]);

    expect(problems).toEqual([
      { rowNumber: 2, code: 'importReferenceUnresolved', column: 'category' },
      { rowNumber: 3, code: 'importReferenceUnresolved', column: 'fits' },
    ]);
  });

  it('refuses what a save would, and a name the sheet repeats', () => {
    const { rows, problems } = read([
      [
        'Nombre',
        'Precio',
        'Precio por',
        'Paso',
        'Mínimo',
        'Escalas',
        'Compatible con',
        'Imagen (URL)',
      ],
      ['A', '1', '7', '', '', '', '', ''],
      ['B', '1', '', '2', '3', '', '', ''],
      ['C', '1', '', '', '', '5=2', '', ''],
      ['D', '1', '', '', '', '', 'Universal; iPhone 15', ''],
      ['E', '1', '', '', '', '', '', 'http://insecure.test/a.png'],
      ['F', '1', '', '', '', '', '', ''],
      ['f', '1', '', '', '', '', '', ''],
    ]);

    expect(rows.map(row => row.name)).toEqual(['F']);
    expect(problems).toEqual([
      { rowNumber: 2, code: 'pricePerInvalid', column: 'pricePer' },
      { rowNumber: 3, code: 'saleRuleInvalid', column: 'minimum' },
      { rowNumber: 4, code: 'priceTiersInvalid', column: 'tiers' },
      { rowNumber: 5, code: 'deviceModelUniversalNotAlone', column: 'fits' },
      { rowNumber: 6, code: 'mediaNotHttps', column: 'image' },
      { rowNumber: 8, code: 'importDuplicate', column: 'name' },
    ]);
  });

  it('rethrows what is not a row it could not read', () => {
    const throwing = {
      get brands(): never {
        throw new TypeError('broken');
      },
      categories: [],
      deviceModels: [],
    };

    expect(() =>
      toImportRows(
        [{ rowNumber: 2, cells: { name: 'A', price: '1', brand: 'x' } }],
        throwing,
        options,
      ),
    ).toThrow('broken');
  });
});

describe('asking a received row again', () => {
  it('refuses what the service must not trust the browser on', () => {
    expect(importRowRefusal(valid)).toBeUndefined();
    expect(importRowRefusal({ ...valid, name: ' ' })).toMatchObject({
      column: 'name',
    });
    expect(importRowRefusal({ ...valid, saleUnit: 'BOX' })).toMatchObject({
      column: 'unit',
    });
    expect(importRowRefusal({ ...valid, currency: 'gtq' })).toMatchObject({
      column: 'currency',
    });
    expect(importRowRefusal({ ...valid, amount: 1.5 })).toMatchObject({
      column: 'price',
    });
    expect(importRowRefusal({ ...valid, amount: -1 })).toMatchObject({
      column: 'price',
    });
    expect(
      importRowRefusal({ ...valid, tiers: [{ from: 5, amount: 100 }] }),
    ).toBeUndefined();
  });
});

describe('the currency and the template', () => {
  it('reads a minor unit off Intl, and none for a code it does not know', () => {
    expect([
      minorUnitDigits('GTQ'),
      minorUnitDigits('JPY'),
      minorUnitDigits('??'),
    ]).toEqual([2, 0, undefined]);
  });

  it('writes a template that reads back in every locale', () => {
    for (const locale of ['es', 'en'] as const) {
      const lines = importTemplateCsv(locale).trimEnd().split('\n');
      const table = lines.map(
        line =>
          line
            .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
            ?.slice(0, IMPORT_COLUMNS.length)
            .map(cell =>
              cell
                .replace(/,$/, '')
                .replace(/^"|"$/g, '')
                .replaceAll('""', '"'),
            ) ?? [],
      );
      const sheet = readImportSheet(table);
      const { rows, problems } = toImportRows(sheet.rows, references, options);

      expect(table[0]).toEqual(
        IMPORT_COLUMNS.map(column => IMPORT_HEADERS[locale][column]),
      );
      expect(sheet.problems).toEqual([]);
      expect(problems).toEqual([]);
      expect(rows[0]).toMatchObject({
        amount: 150,
        tiers: [
          { from: 100, amount: 125 },
          { from: 500, amount: 110 },
        ],
      });
    }
  });
});

describe('the refusals an import adds', () => {
  it('registers each code with a message naming the row and the column', () => {
    const refusals = [
      new ImportColumnUnknown({ rowNumber: 1 }),
      new ImportColumnMissing({ rowNumber: 1, column: 'price' }),
      new ImportCellInvalid({ rowNumber: 3, column: 'price' }),
      new ImportReferenceUnresolved({ rowNumber: 4, column: 'brand' }),
      new ImportDuplicate({ rowNumber: 5, column: 'name' }),
      new ImportEmpty({ rowNumber: 1 }),
    ];

    expect(refusals.map(refusal => [refusal.code, refusal.message])).toEqual([
      ['importColumnUnknown', 'the sheet has a column the template does not'],
      ['importColumnMissing', "the sheet has no 'price' column"],
      ['importCellInvalid', "row 3: 'price' cannot be read"],
      [
        'importReferenceUnresolved',
        "row 4: 'brand' names nothing in the catalog",
      ],
      ['importDuplicate', 'row 5: a product with this name already exists'],
      ['importEmpty', 'the sheet has no products'],
    ]);
  });
});
