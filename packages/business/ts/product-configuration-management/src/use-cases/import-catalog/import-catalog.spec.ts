import { EntityRepositoryFactoryTag } from '@entifix/business';
import { describeEntityUseCases } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { CatalogImport } from '../../entities/catalog-import/catalog-import.entity.js';
import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import { ProductOfferingPrice } from '../../entities/product-offering-price/product-offering-price.entity.js';
import { ProductSpecification } from '../../entities/product-specification/product-specification.entity.js';
import { CatalogImportCommandsTag } from '../../ports/catalog-import.js';
import { makeInMemoryCatalogImportCommands } from '../../testing/in-memory-catalog-import.js';
import type { ImportRow } from '../../values/import-sheet.js';
import { contentHashOf } from '../../values/specification-lifecycle.js';
import {
  IMPORT_CATALOG,
  type ImportCatalogPayload,
  ImportCatalogUC,
} from './import-catalog.uc.js';

const AT = new Date('2026-11-25T10:00:00.000Z');

const row = (
  rowNumber: number,
  overrides: Partial<ImportRow> = {},
): ImportRow => ({
  rowNumber,
  name: `Product ${String(rowNumber)}`,
  amount: 1500,
  currency: 'GTQ',
  pricePer: 1,
  saleUnit: 'UN',
  quantityStep: 1,
  quantityMinimum: 1,
  ...overrides,
});

const stored = (
  name: string,
  lifecycleStatus: ProductSpecification['lifecycleStatus'],
) =>
  Object.assign(new ProductSpecification('product-900', name), {
    id: `s-${name}-${String(lifecycleStatus)}`,
    lifecycleStatus,
  });

const world = (
  specifications: ProductSpecification[] = [],
  catalog: {
    readonly offerings?: ProductOffering[];
    readonly prices?: ProductOfferingPrice[];
  } = {},
) => {
  const commands = makeInMemoryCatalogImportCommands();
  const repositories = new Map<unknown, unknown[]>([
    [ProductOffering, catalog.offerings ?? []],
    [ProductOfferingPrice, catalog.prices ?? []],
  ]);
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: (entity: unknown) =>
        Effect.succeed(
          makeInMemoryEntityRepository(
            (repositories.get(entity) ?? specifications) as never[],
          ),
        ),
    }),
    Layer.succeed(CatalogImportCommandsTag, commands),
  );
  const run = (
    payload: Partial<ImportCatalogPayload> & Pick<ImportCatalogPayload, 'rows'>,
    options: { readonly key?: string; readonly maxRows?: number } = {},
  ) =>
    Effect.runPromiseExit(
      ImportCatalogUC.run({
        organizationId: 'acme',
        key: options.key ?? 'import-1',
        source: 'marketplace-admin',
        at: AT,
        maxRows: options.maxRows ?? 500,
        payload: { fileName: 'catalog.csv', mode: 'draft', ...payload },
      }).pipe(Effect.provide(layer)),
    );
  return { commands, run };
};

const valueOf = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

const codeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  return (
    Option.getOrThrow(Cause.findErrorOption(exit.cause)) as {
      readonly code: string;
    }
  ).code;
};

const messageOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? (
        Option.getOrThrow(Cause.findErrorOption(exit.cause)) as {
          readonly message: string;
        }
      ).message
    : undefined;

describe('the import verb', () => {
  it('is unbound, opened by its wizard, under its own permission', () => {
    const [descriptor] = describeEntityUseCases(CatalogImport);

    expect(descriptor).toMatchObject({
      key: 'import',
      binding: 'unbound',
      form: 'catalog-import',
    });
    expect(IMPORT_CATALOG).toBe(
      'product-configuration-management:catalog-import:import',
    );
  });
});

describe('importing a sheet as drafts', () => {
  it('writes each row as a product in design, a draft offering and its price', async () => {
    const { commands, run } = world();

    const record = valueOf(
      await run({
        rows: [
          row(2, {
            description: 'Zinc',
            brandId: 'b-1',
            categoryId: 'c-1',
            fitsDeviceModelIds: ['universal'],
            imageUrl: 'https://media.example.test/a.png',
            tiers: [{ from: 10, amount: 1200 }],
          }),
          row(3, {
            saleUnit: 'M',
            quantityStep: 500,
            quantityMinimum: 1000,
            pricePer: 100,
          }),
        ],
      }),
    );

    expect(record).toMatchObject({
      id: 'import-1',
      fileName: 'catalog.csv',
      mode: 'draft',
      status: 'completed',
      rowCount: 2,
      createdCount: 2,
      rejectedCount: 0,
      importedAt: AT,
    });
    expect(record.rejections).toBeUndefined();
    const [first, second] = commands.state.rows;
    expect(first?.specification).toMatchObject({
      code: 'product-001',
      name: 'Product 2',
      version: 1,
      lifecycleStatus: 'in-design',
      description: 'Zinc',
      brandId: 'b-1',
      categoryId: 'c-1',
      fitsDeviceModelIds: ['universal'],
    });
    expect(first?.specification.media).toEqual([
      expect.objectContaining({
        url: 'https://media.example.test/a.png',
        alt: 'Product 2',
      }),
    ]);
    expect(first?.offering).toMatchObject({
      status: 'draft',
      saleUnit: 'UN',
      specificationId: first?.specification.id,
    });
    expect(first?.price).toMatchObject({
      offeringId: first?.offering.id,
      amount: 1500,
      currency: 'GTQ',
      tiers: [{ from: 10, amount: 1200 }],
    });
    expect(second?.offering).toMatchObject({
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 1000,
    });
    expect(second?.price.pricePer).toBe(100);
    expect(second?.price.tiers).toBeUndefined();
    expect(second?.specification.media).toBeUndefined();
    expect(commands.state.announced).toEqual([]);
  });

  it('refuses a sheet past the cap before writing a row', async () => {
    const { commands, run } = world();

    const exit = await run({ rows: [row(2), row(3)] }, { maxRows: 1 });

    expect(codeOf(exit)).toBe('importTooLarge');
    expect(messageOf(exit)).toBe(
      'an import takes at most 1 rows; this one has 2',
    );
    expect(commands.state.rows).toHaveLength(0);
  });
});

describe('importing a sheet on sale', () => {
  it('releases each version and announces its offering in the same row', async () => {
    const { commands, run } = world();

    valueOf(
      await run({
        mode: 'publish',
        rows: [row(2, { tiers: [{ from: 10, amount: 1200 }] })],
      }),
    );

    const [written] = commands.state.rows;
    expect(written?.specification).toMatchObject({
      lifecycleStatus: 'active',
      validFrom: AT,
      contentHash: await Effect.runPromise(
        contentHashOf(written?.specification ?? {}),
      ),
    });
    expect(written?.offering).toMatchObject({
      status: 'published',
      statusChangedAt: AT,
    });
    expect(commands.state.announced).toEqual([
      expect.objectContaining({
        name: 'catalog.published',
        data: expect.objectContaining({
          offeringId: written?.offering.id,
          vendorId: 'acme',
          code: 'product-001',
          amount: 1500,
          specificationVersion: 1,
          tiers: [{ from: 10, amount: 1200 }],
          publishedAt: AT.toISOString(),
        }),
      }),
    ]);
  });
});

describe('refusing rows', () => {
  it('reports each refused row with its code and goes on', async () => {
    const { commands, run } = world([
      stored('Taken', 'active'),
      stored('Designing', 'in-design'),
      stored('Gone', 'retired'),
    ]);

    const record = valueOf(
      await run({
        rows: [
          row(2, { name: 'Taken' }),
          row(3, { name: 'Designing' }),
          row(4, { name: 'Gone' }),
          row(5, { saleUnit: 'BOX' }),
          row(6, { name: 'Twice' }),
          row(7, { name: ' twice ' }),
        ],
      }),
    );

    expect(record).toMatchObject({
      status: 'partial',
      rowCount: 6,
      createdCount: 2,
      rejectedCount: 4,
      rejections: [
        { rowNumber: 2, code: 'importDuplicate', column: 'name' },
        { rowNumber: 3, code: 'importDuplicate', column: 'name' },
        { rowNumber: 5, code: 'importCellInvalid', column: 'unit' },
        { rowNumber: 7, code: 'importDuplicate', column: 'name' },
      ],
    });
    expect(
      commands.state.rows.map(({ specification }) => specification.name),
    ).toEqual(['Gone', 'Twice']);
  });
});

describe('two attempts at one sheet at once', () => {
  it('replays a row another attempt wrote after this one first looked', async () => {
    const { commands, run } = world([stored('Product 2', 'in-design')]);
    // As if a concurrent attempt committed row 2 — its product, which the
    // name check now sees, and its claim — just after this attempt's first
    // claim read.
    let reads = 0;
    const claimed = commands.claimed;
    (commands as { claimed: typeof claimed }).claimed = (
      organizationId,
      key,
    ) => {
      reads += 1;
      return reads === 1
        ? Effect.succeed(undefined)
        : Effect.succeed({
            outcome: 'replayed' as const,
            change: 'create' as const,
            specificationId: 's-raced',
            offeringId: 'o-raced',
          });
    };

    const record = valueOf(await run({ rows: [row(2)] }));

    expect(record).toMatchObject({ createdCount: 1, rejectedCount: 0 });
    expect(commands.state.rows).toHaveLength(0);
  });
});

describe('importing the same sheet again', () => {
  it('replays every row the key wrote and answers the first record', async () => {
    const { commands, run } = world();
    const rows = [row(2), row(3)];

    const first = valueOf(await run({ rows }));
    // The first attempt's products now exist, and are not duplicates of
    // themselves: the key's claim is read before the name check.
    const again = valueOf(await run({ rows, fileName: 'renamed.csv' }));

    expect(commands.state.rows).toHaveLength(2);
    expect(again).toBe(first);
    expect(again.fileName).toBe('catalog.csv');
  });

  it('resumes a run that stopped before its record was written', async () => {
    const { commands, run } = world();

    valueOf(await run({ rows: [row(2)] }));
    // As if the service fell over after row 2 and before the record.
    commands.state.records.clear();
    const resumed = valueOf(await run({ rows: [row(2), row(3)] }));

    expect(resumed.createdCount).toBe(2);
    expect(commands.state.rows).toHaveLength(2);
  });
});

describe('a row naming an offering by its SKU', () => {
  const spec = (
    lifecycleStatus: ProductSpecification['lifecycleStatus'] = 'active',
  ) =>
    Object.assign(new ProductSpecification('product-007', 'Taco Fisher'), {
      id: 's-7',
      lifecycleStatus,
      description: 'Nylon',
      brandId: 'b-1',
      categoryId: 'c-1',
      fitsDeviceModelIds: ['m-1', 'm-2'],
      media: [{ url: 'https://media.example.test/taco.png', alt: 'Taco' }],
    });
  const coded = (overrides: Partial<ProductOffering> = {}) =>
    Object.assign(new ProductOffering('Taco Fisher 8', 's-7'), {
      id: 'o-7',
      sku: 'TAC-8',
      revision: 3,
      ...overrides,
    });
  const priced = () =>
    Object.assign(new ProductOfferingPrice('o-7', 1000, 'GTQ'), {
      id: 'p-7',
      revision: 2,
    });
  const update = (overrides: Partial<ImportRow> = {}) =>
    row(2, {
      sku: 'TAC-8',
      name: 'Taco Fisher 8 mm',
      amount: 1250,
      quantityStep: 2,
      quantityMinimum: 2,
      tiers: [{ from: 10, amount: 1100 }],
      ...overrides,
    });

  it('changes a draft’s name, sale terms and price at the revisions read, and announces nothing', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded()],
      prices: [priced()],
    });

    const record = valueOf(await run({ rows: [update()] }));

    expect(record).toMatchObject({
      createdCount: 0,
      updatedCount: 1,
      rejectedCount: 0,
      status: 'completed',
    });
    const [written] = commands.state.updated;
    expect(written?.offering).toMatchObject({
      id: 'o-7',
      name: 'Taco Fisher 8 mm',
      quantityStep: 2,
      quantityMinimum: 2,
      revision: 3,
      status: 'draft',
    });
    expect(written?.price).toMatchObject({
      id: 'p-7',
      amount: 1250,
      tiers: [{ from: 10, amount: 1100 }],
      revision: 2,
    });
    expect(written?.priceIsNew).toBe(false);
    expect(commands.state.announced).toHaveLength(0);
  });

  it('republishes an offering on sale with its new price, whatever the sheet’s mode', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded({ status: 'published' })],
      prices: [priced()],
    });

    const record = valueOf(await run({ rows: [update({ tiers: [] })] }));

    expect(record.rejections).toBeUndefined();
    const [event] = commands.state.announced;
    expect(event?.name).toBe('catalog.published');
    expect(event?.data).toMatchObject({
      offeringId: 'o-7',
      sku: 'TAC-8',
      name: 'Taco Fisher 8 mm',
      amount: 1250,
      publishedAt: AT.toISOString(),
    });
    expect('tiers' in (event?.data ?? {})).toBe(false);
    expect(commands.state.updated[0]?.offering.statusChangedAt).toEqual(AT);
  });

  it('writes the first price of an offering that had none', async () => {
    const { commands, run } = world([spec()], { offerings: [coded()] });

    valueOf(await run({ rows: [update()] }));

    expect(commands.state.updated[0]).toMatchObject({
      priceIsNew: true,
      price: { offeringId: 'o-7', amount: 1250 },
    });
  });

  it('keeps what a cell left empty or repeated, whatever order the phones are in', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded()],
      prices: [priced()],
    });

    const record = valueOf(
      await run({
        rows: [
          update({
            description: 'Nylon',
            brandId: 'b-1',
            categoryId: 'c-1',
            fitsDeviceModelIds: ['m-2', 'm-1'],
            imageUrl: 'https://media.example.test/taco.png',
          }),
        ],
      }),
    );

    expect(record.updatedCount).toBe(1);
    expect(commands.state.updated).toHaveLength(1);
  });

  // A sheet of prices alone: every sale-term cell empty, read as its default.
  const priceOnly = (overrides: Partial<ImportRow> = {}) =>
    row(2, {
      sku: 'TAC-8',
      name: 'Taco Fisher 8 mm',
      amount: 1250,
      defaulted: ['unit', 'pricePer', 'step', 'minimum', 'tiers'],
      ...overrides,
    });

  it('keeps the unit, step, minimum, price basis and tiers a sheet of prices left empty', async () => {
    const { commands, run } = world([spec()], {
      offerings: [
        coded({ saleUnit: 'M', quantityStep: 500, quantityMinimum: 6000 }),
      ],
      prices: [
        Object.assign(priced(), {
          pricePer: 100,
          tiers: [{ from: 20_000, amount: 900 }],
        }),
      ],
    });

    const record = valueOf(await run({ rows: [priceOnly()] }));

    expect(record.rejections).toBeUndefined();
    const [written] = commands.state.updated;
    expect(written?.offering).toMatchObject({
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 6000,
    });
    expect(written?.price).toMatchObject({
      amount: 1250,
      pricePer: 100,
      tiers: [{ from: 20_000, amount: 900 }],
    });
  });

  it('reads an empty price basis as the default for an offering that had no price', async () => {
    const { commands, run } = world([spec()], { offerings: [coded()] });

    valueOf(await run({ rows: [priceOnly()] }));

    expect(commands.state.updated[0]?.price).toMatchObject({ pricePer: 1 });
  });

  it('refuses a quantity read in the default unit for a product sold in another', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded({ saleUnit: 'M', quantityStep: 500 })],
      prices: [priced()],
    });

    const record = valueOf(
      await run({
        rows: [
          priceOnly({
            quantityStep: 2,
            quantityMinimum: 2,
            defaulted: ['unit', 'pricePer', 'tiers'],
          }),
        ],
      }),
    );

    expect(record.rejections).toEqual([
      { rowNumber: 2, code: 'saleUnitFixed', column: 'unit' },
    ]);
    expect(commands.state.updated).toHaveLength(0);
  });

  it('refuses a step that leaves the kept minimum unsellable', async () => {
    const { run } = world([spec()], {
      offerings: [coded({ quantityStep: 1, quantityMinimum: 3 })],
      prices: [priced()],
    });

    const record = valueOf(
      await run({
        rows: [
          priceOnly({
            quantityStep: 2,
            // What the cell's default would be; the stored 3 is kept.
            quantityMinimum: 2,
            defaulted: ['unit', 'pricePer', 'minimum', 'tiers'],
          }),
        ],
      }),
    );

    expect(record.rejections).toEqual([
      { rowNumber: 2, code: 'saleRuleInvalid', column: 'minimum' },
    ]);
  });

  it('refuses a price lowered under the tiers it keeps', async () => {
    const { run } = world([spec()], {
      offerings: [coded()],
      prices: [Object.assign(priced(), { tiers: [{ from: 10, amount: 900 }] })],
    });

    const record = valueOf(await run({ rows: [priceOnly({ amount: 800 })] }));

    expect(record.rejections).toEqual([
      { rowNumber: 2, code: 'priceTiersInvalid', column: 'tiers' },
    ]);
  });

  it.each([
    ['unit', { saleUnit: 'M' }, 'saleUnitFixed'],
    ['description', { description: 'Plástico' }, 'importSpecificationChanged'],
    ['brand', { brandId: 'b-2' }, 'importSpecificationChanged'],
    ['category', { categoryId: 'c-2' }, 'importSpecificationChanged'],
    ['fits', { fitsDeviceModelIds: ['m-1'] }, 'importSpecificationChanged'],
    [
      'image',
      { imageUrl: 'https://media.example.test/other.png' },
      'importSpecificationChanged',
    ],
  ] as const)(
    'refuses a row whose %s differs from the product’s',
    async (column, overrides, code) => {
      const { commands, run } = world([spec()], {
        offerings: [coded()],
        prices: [priced()],
      });

      const record = valueOf(await run({ rows: [update(overrides)] }));

      expect(record.rejections).toEqual([{ rowNumber: 2, code, column }]);
      expect(commands.state.updated).toHaveLength(0);
    },
  );

  it.each([
    ['description', { description: 'Nylon' }],
    ['fits', { fitsDeviceModelIds: ['m-1'] }],
    ['image', { imageUrl: 'https://media.example.test/taco.png' }],
  ] as const)(
    'refuses a %s cell for an offering whose product is gone',
    async (column, overrides) => {
      const { run } = world([], { offerings: [coded()], prices: [priced()] });

      const record = valueOf(await run({ rows: [update(overrides)] }));

      expect(record.rejections).toEqual([
        { rowNumber: 2, code: 'importSpecificationChanged', column },
      ]);
    },
  );

  it('republishes a presentation from its base, and a kit with what it takes from each component', async () => {
    const base = Object.assign(new ProductOffering('Taco suelto', 's-7'), {
      id: 'o-base',
      status: 'published' as const,
    });
    const box = coded({
      status: 'published',
      stockOfferingId: 'o-base',
      stockFactor: 12,
    });
    const kit = Object.assign(new ProductOffering('Kit', 's-7'), {
      id: 'o-kit',
      sku: 'KIT-1',
      status: 'published' as const,
      kitComponents: [{ offeringId: 'o-base', quantity: 2 }],
      kitSize: 1,
    });
    const { commands, run } = world([spec()], {
      offerings: [base, box, kit],
      prices: [priced()],
    });

    valueOf(
      await run({ rows: [update(), row(3, { sku: 'KIT-1', name: 'Kit' })] }),
    );

    expect(commands.state.announced.map(event => event.data)).toEqual([
      expect.objectContaining({ stockOfferingId: 'o-base', stockFactor: 12 }),
      expect.objectContaining({
        kitComponents: [
          expect.objectContaining({ offeringId: 'o-base', stockQuantity: 2 }),
        ],
      }),
    ]);
  });

  it('replays a row another attempt updated after this one first looked', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded()],
      prices: [priced()],
    });
    (commands as { updateRow: typeof commands.updateRow }).updateRow = () =>
      Effect.succeed('changed' as const);
    let reads = 0;
    (commands as { claimed: typeof commands.claimed }).claimed = () => {
      reads += 1;
      return Effect.succeed(
        reads === 1
          ? undefined
          : {
              outcome: 'replayed' as const,
              change: 'update' as const,
              specificationId: 's-7',
              offeringId: 'o-7',
            },
      );
    };

    const record = valueOf(await run({ rows: [update()] }));

    expect(record).toMatchObject({ updatedCount: 1, rejectedCount: 0 });
  });

  it.each([
    [
      'its product is not released',
      [spec('in-design')],
      [coded({ status: 'published' })],
      'specificationNotActive',
    ],
    [
      'it draws on a base that is gone',
      [spec()],
      [
        coded({
          status: 'published',
          stockOfferingId: 'o-gone',
          stockFactor: 12,
        }),
      ],
      'stockSourceInvalid',
    ],
    [
      'it is a kit whose component is gone',
      [spec()],
      [
        coded({
          status: 'published',
          kitComponents: [{ offeringId: 'o-gone', quantity: 1 }],
          kitSize: 1,
        }),
      ],
      'kitInvalid',
    ],
  ] as const)(
    'refuses to republish an offering on sale when %s',
    async (_why, specifications, offerings, code) => {
      const { commands, run } = world([...specifications], {
        offerings: [...offerings],
        prices: [priced()],
      });

      const record = valueOf(await run({ rows: [update()] }));

      expect(record.rejections).toEqual([
        { rowNumber: 2, code, column: 'sku' },
      ]);
      expect(commands.state.announced).toHaveLength(0);
    },
  );

  it('refuses a row whose offering moved since it was read, and a SKU the sheet already used', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded()],
      prices: [priced()],
    });
    (commands as { updateRow: typeof commands.updateRow }).updateRow = () =>
      Effect.succeed('changed' as const);

    const record = valueOf(
      await run({
        rows: [update(), { ...update(), rowNumber: 3 }],
      }),
    );

    expect(record.rejections).toEqual([
      { rowNumber: 2, code: 'staleRevision', column: 'sku' },
      { rowNumber: 3, code: 'importDuplicate', column: 'sku' },
    ]);
  });

  // Both sheets looked the code up and found it free; the store's index
  // decides which of the two creates it.
  it('refuses a new SKU another sheet created first, and keeps one this sheet created', async () => {
    const { commands, run } = world();
    (commands as { importRow: typeof commands.importRow }).importRow = () =>
      Effect.succeed('skuTaken' as const);
    // Row 2 was taken by another attempt at this very sheet, which claimed it
    // after this attempt's first read of the claim.
    let reads = 0;
    (commands as { claimed: typeof commands.claimed }).claimed = (_, key) =>
      Effect.sync(() =>
        key.endsWith(':2') && (reads += 1) > 1
          ? {
              outcome: 'replayed' as const,
              change: 'create' as const,
              specificationId: 's-1',
              offeringId: 'o-1',
            }
          : undefined,
      );

    const record = valueOf(
      await run({
        rows: [row(2, { sku: 'NEW-1' }), row(3, { sku: 'NEW-2' })],
      }),
    );

    expect(record.createdCount).toBe(1);
    expect(record.rejections).toEqual([
      { rowNumber: 3, code: 'importDuplicate', column: 'sku' },
    ]);
  });

  it('counts a replayed update as an update', async () => {
    const { commands, run } = world([spec()], {
      offerings: [coded()],
      prices: [priced()],
    });

    valueOf(await run({ rows: [update()] }));
    const replayed = valueOf(await run({ rows: [update()] }));

    expect(replayed).toMatchObject({ updatedCount: 1, createdCount: 0 });
    expect(commands.state.updated).toHaveLength(1);
  });

  it('creates a product with a SKU the catalog does not hold, and keeps it', async () => {
    const { commands, run } = world();

    const record = valueOf(await run({ rows: [row(2, { sku: 'NEW-1' })] }));

    expect(record).toMatchObject({ createdCount: 1, updatedCount: 0 });
    expect(commands.state.rows[0]?.offering.sku).toBe('NEW-1');
  });

  it('creates two products of one name when each has its own new SKU... unless the name is taken', async () => {
    const { run } = world();

    const record = valueOf(
      await run({
        rows: [
          row(2, { sku: 'A-1', name: 'Funda' }),
          row(3, { sku: 'A-2', name: 'Funda' }),
        ],
      }),
    );

    // The sheet itself does not refuse them; the catalog's own products by
    // name are what a create is checked against.
    expect(record).toMatchObject({ createdCount: 2, rejectedCount: 0 });
  });
});
