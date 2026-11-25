import {
  type EntityApiContext,
  EntityRepositoryFactoryTag,
  IdempotencyKeyTag,
} from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { EventSourceTag } from '@entifix/transactions';
import {
  CatalogImportCommandsTag,
  CatalogImportLimitTag,
} from '@r10c/business-ts-product-configuration-management';
import { makeInMemoryCatalogImportCommands } from '@r10c/business-ts-product-configuration-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { catalogImportApi } from './catalog-api.js';

const context: EntityApiContext = {
  organizationId: 'acme',
  links: {
    record: id => [{ rel: 'self', href: `/x/${String(id)}` }],
    collection: () => [],
  },
};

const [importCatalog] = catalogImportApi.options.useCases;

const payload = {
  fileName: 'catalog.csv',
  mode: 'draft',
  rows: [
    {
      rowNumber: 2,
      name: 'Tornillo',
      amount: 150,
      currency: 'GTQ',
      pricePer: 1,
      saleUnit: 'UN',
      quantityStep: 1,
      quantityMinimum: 1,
    },
  ],
};

const run = (key: string | undefined) => {
  const commands = makeInMemoryCatalogImportCommands();
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: () => Effect.succeed(makeInMemoryEntityRepository([])),
    }),
    Layer.succeed(CatalogImportCommandsTag, commands),
    Layer.succeed(CatalogImportLimitTag, { maxRows: 10 }),
    Layer.succeed(EventSourceTag, 'marketplace-admin'),
  );
  const handled = importCatalog?.handler({ payload }, context) as Effect.Effect<
    unknown,
    unknown,
    never
  >;
  return Effect.runPromise(
    (key === undefined
      ? handled
      : Effect.provideService(handled, IdempotencyKeyTag, key)
    ).pipe(Effect.provide(layer as never)),
  ) as Promise<{ readonly data: Record<string, unknown> }>;
};

describe('the catalog import route', () => {
  it('serves reads and the one verb, never a save', () => {
    expect(catalogImportApi.options.verbs).toEqual(['list', 'get']);
    expect(importCatalog?.idempotent).toBe('unit');
  });

  it('answers the import record, under the request key', async () => {
    const answered = await run('key-1');

    expect(answered.data).toMatchObject({
      id: 'key-1',
      fileName: 'catalog.csv',
      status: 'completed',
      createdCount: 1,
    });
  });

  it('mints an id for a request that sent no key', async () => {
    const answered = await run(undefined);

    expect(typeof answered.data['id']).toBe('string');
  });
});
