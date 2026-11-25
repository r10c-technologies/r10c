import { EntityRepositoryFactoryTag } from '@entifix/business';
import { describeEntityUseCases } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { CatalogImport } from '../../entities/catalog-import/catalog-import.entity.js';
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

const world = (specifications: ProductSpecification[] = []) => {
  const commands = makeInMemoryCatalogImportCommands();
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: () => Effect.succeed(makeInMemoryEntityRepository(specifications)),
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
