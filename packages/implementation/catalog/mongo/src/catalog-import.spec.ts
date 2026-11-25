import {
  ConfigurationRepositoryTag,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import { ConfigurationClientInMemory } from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import { OUTBOX_COLLECTION } from '@entifix/mongo/transactions';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import { catalogPublishedEvent } from '@r10c/business-ts-catalog-contracts';
import {
  CatalogImport,
  CatalogImportCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import {
  describeCatalogImportCommandsContract,
  importedRowOf,
} from '@r10c/business-ts-product-configuration-management/testing';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  CATALOG_IMPORT_COLLECTION,
  MongoCatalogImportCommandsLayer,
} from './catalog-import-commands.js';
import { OFFERING_COLLECTION, PRICE_COLLECTION } from './offering-catalog.js';
import {
  COUNTERS_COLLECTION,
  SPECIFICATION_COLLECTION,
} from './specification-commands.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;

const named = (fake: Fake, name: string) =>
  Object.assign(fake.db as object, { databaseName: name }) as Db;

/** The cell over one client, each organization resolving to its own fake. */
const layerOver = (
  client: Fake,
  databases: Readonly<Record<string, Db>>,
  bus = makeRecordingEventBus(),
) =>
  MongoCatalogImportCommandsLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MongoClientTag, client as never),
        Layer.succeed(TenantDatabaseResolverTag, {
          forOrganization: (organizationId: string) =>
            Effect.succeed(databases[organizationId] as Db),
        }),
        Layer.succeed(
          ConfigurationRepositoryTag,
          new ConfigurationClientInMemory({}),
        ),
        Layer.succeed(EventBusTag, bus),
        Layer.succeed(OutboxMaxAttempts, 3),
        Layer.succeed(EventSourceTag, 'marketplace-admin'),
      ),
    ),
  );

const world = (seed: Record<string, Record<string, unknown>[]> = {}) => {
  const fake = makeFakeMongoDb(seed);
  const bus = makeRecordingEventBus();
  const layer = layerOver(fake, { acme: named(fake, 'tenant_acme') }, bus);
  const run = <A, E>(effect: Effect.Effect<A, E, CatalogImportCommandsTag>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  return { fake, bus, run };
};

describeCatalogImportCommandsContract('the Mongo catalog import', async () => {
  const acme = makeFakeMongoDb();
  const other = makeFakeMongoDb();
  return Effect.runPromise(
    Effect.provide(
      Effect.map(CatalogImportCommandsTag, commands => commands),
      layerOver(acme, {
        acme: named(acme, 'tenant_acme'),
        other: named(other, 'tenant_other'),
      }),
    ),
  );
});

const publication = (code: string) =>
  catalogPublishedEvent(
    {
      offeringId: 'o-1',
      vendorId: 'acme',
      name: 'A mug',
      amount: 100,
      currency: 'GTQ',
      availableHint: true,
      publishedAt: '2026-11-25T10:00:00.000Z',
      specificationId: 'spec-1',
      specificationVersion: 1,
      saleUnit: 'UN',
      quantityStep: 1,
      quantityMinimum: 1,
      pricePer: 1,
      code,
    },
    'marketplace-admin',
  );

const settled = () => new Promise(resolve => setTimeout(resolve, 20));

describe('importing a row', () => {
  it('writes the product, its offering and its price under one drawn code', async () => {
    const w = world();
    const row = importedRowOf('A mug');

    await w.run(
      Effect.flatMap(CatalogImportCommandsTag, commands =>
        commands.importRow('acme', 'import-1:2', row),
      ),
    );

    expect(w.fake.read(SPECIFICATION_COLLECTION)).toEqual([
      expect.objectContaining({
        id: row.specification.id,
        code: 'product-001',
        specKey: 'product-001',
        revision: 1,
      }),
    ]);
    expect(w.fake.read(OFFERING_COLLECTION)).toEqual([
      expect.objectContaining({
        id: row.offering.id,
        specificationId: row.specification.id,
      }),
    ]);
    expect(w.fake.read(PRICE_COLLECTION)).toEqual([
      expect.objectContaining({
        id: row.price.id,
        offeringId: row.offering.id,
      }),
    ]);
    expect(w.fake.read(OUTBOX_COLLECTION)).toEqual([]);
  });

  it('announces a row put on sale in the same unit, and drains it at once', async () => {
    const w = world();

    await w.run(
      Effect.flatMap(CatalogImportCommandsTag, commands =>
        commands.importRow(
          'acme',
          'import-1:2',
          importedRowOf('A mug', specification =>
            Effect.succeed(publication(specification.code)),
          ),
        ),
      ),
    );
    await settled();

    expect(w.bus.published).toEqual([
      expect.objectContaining({
        name: 'catalog.published',
        data: expect.objectContaining({ code: 'product-001' }),
      }),
    ]);
  });

  it('writes nothing and spends no code when a record cannot be written', async () => {
    const w = world();
    w.fake.failOn('insertOne', new Error('disk full'));

    const failure = await w.run(
      Effect.flip(
        Effect.flatMap(CatalogImportCommandsTag, commands =>
          commands.importRow('acme', 'import-1:2', importedRowOf('A mug')),
        ),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'Unavailable', dependency: 'mongo' });
    expect(w.fake.read(SPECIFICATION_COLLECTION)).toEqual([]);
    expect(w.fake.read(COUNTERS_COLLECTION)).toEqual([]);
  });

  it('fails as the store when a claim answers something that is not two ids', async () => {
    const w = world({
      command_inbox: [
        {
          commandId: 'import-1:2',
          claimedAt: new Date().toISOString(),
          replay: 'not ids',
        },
        {
          commandId: 'import-1:3',
          claimedAt: new Date().toISOString(),
          replay: null,
        },
      ],
    });

    const [claimed, imported] = await w.run(
      Effect.flatMap(CatalogImportCommandsTag, commands =>
        Effect.all([
          Effect.flip(commands.claimed('acme', 'import-1:2')),
          Effect.flip(
            commands.importRow('acme', 'import-1:2', importedRowOf('A mug')),
          ),
        ]),
      ),
    );

    const nothing = await w.run(
      Effect.flip(
        Effect.flatMap(CatalogImportCommandsTag, commands =>
          commands.claimed('acme', 'import-1:3'),
        ),
      ),
    );

    expect(claimed).toMatchObject({ _tag: 'Unavailable' });
    expect(imported).toMatchObject({ _tag: 'Unavailable' });
    expect(nothing).toMatchObject({ _tag: 'Unavailable' });
  });
});

describe('recording an import', () => {
  it('stores the record, and answers the first one to a second attempt', async () => {
    const w = world();
    const first = Object.assign(new CatalogImport('a.csv'), {
      id: 'import-1',
      rowCount: 1,
    });

    const [written, again] = await w.run(
      Effect.flatMap(CatalogImportCommandsTag, commands =>
        Effect.all([
          commands.record('acme', first),
          commands.record(
            'acme',
            Object.assign(new CatalogImport('b.csv'), { id: 'import-1' }),
          ),
        ]),
      ),
    );

    expect(written).toBe(first);
    expect(again).toBeInstanceOf(CatalogImport);
    expect(again.fileName).toBe('a.csv');
    expect(w.fake.read(CATALOG_IMPORT_COLLECTION)).toHaveLength(1);
  });

  it('fails as the store when the stored answer will not revive', async () => {
    const w = world({
      command_inbox: [
        {
          commandId: 'catalog-import:import-1',
          claimedAt: new Date().toISOString(),
          replay: 'not a record',
        },
      ],
    });

    const failure = await w.run(
      Effect.flip(
        Effect.flatMap(CatalogImportCommandsTag, commands =>
          commands.record(
            'acme',
            Object.assign(new CatalogImport('a.csv'), { id: 'import-1' }),
          ),
        ),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'Unavailable' });
  });
});
