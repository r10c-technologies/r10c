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
  OfferingCatalogTag,
  ProductOffering,
  ProductSpecification,
  SpecificationCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import {
  CONTRACT_OFFERINGS,
  describeOfferingCatalogContract,
  describeSpecificationCommandsContract,
} from '@r10c/business-ts-product-configuration-management/testing';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  MongoOfferingCatalogLayer,
  OFFERING_COLLECTION,
} from './offering-catalog.js';
import {
  COUNTERS_COLLECTION,
  MongoSpecificationCommandsLayer,
  SPECIFICATION_COLLECTION,
} from './specification-commands.js';

type Seed = Record<string, Record<string, unknown>[]>;

/** Both cells over one client, each organization resolving to its own fake. */
const layerOver = (
  client: ReturnType<typeof makeFakeMongoDb>,
  databases: Readonly<Record<string, Db>>,
  bus = makeRecordingEventBus(),
) =>
  Layer.mergeAll(
    MongoOfferingCatalogLayer,
    MongoSpecificationCommandsLayer,
  ).pipe(
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

const named = (fake: ReturnType<typeof makeFakeMongoDb>, name: string) =>
  Object.assign(fake.db as object, { databaseName: name }) as Db;

const world = (seed: Seed = {}) => {
  const fake = makeFakeMongoDb(seed);
  const bus = makeRecordingEventBus();
  const layer = layerOver(fake, { acme: named(fake, 'tenant_acme') }, bus);
  const run = <A, E>(
    effect: Effect.Effect<A, E, OfferingCatalogTag | SpecificationCommandsTag>,
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  return { fake, bus, run };
};

/** Each contract organization in its own database, seeded as the suite says. */
const contractPorts = () => {
  const fakes = Object.entries(CONTRACT_OFFERINGS).map(
    ([organizationId, offerings]) =>
      [
        organizationId,
        makeFakeMongoDb({
          [OFFERING_COLLECTION]: offerings.map(offering => ({ ...offering })),
        }),
      ] as const,
  );
  const layer = layerOver(
    fakes[0]?.[1] as ReturnType<typeof makeFakeMongoDb>,
    Object.fromEntries(
      fakes.map(([organizationId, fake]) => [
        organizationId,
        named(fake, `tenant_${organizationId}`),
      ]),
    ),
  );
  return Effect.runPromise(
    Effect.all([OfferingCatalogTag, SpecificationCommandsTag]).pipe(
      Effect.provide(layer),
    ),
  );
};

describeOfferingCatalogContract('the Mongo catalog', async () => {
  const [catalog] = await contractPorts();
  return catalog;
});
describeSpecificationCommandsContract('the Mongo commands', async () => {
  const [, commands] = await contractPorts();
  return commands;
});

const offering = (status: ProductOffering['status']) =>
  Object.assign(new ProductOffering('A mug', 'spec-1'), { id: 'o-1', status });

const publicationEvent = (at = '2026-10-25T10:00:00.000Z') =>
  catalogPublishedEvent(
    {
      offeringId: 'o-1',
      vendorId: 'acme',
      name: 'A mug',
      amount: 100,
      currency: 'GTQ',
      availableHint: true,
      publishedAt: at,
    },
    'marketplace-admin',
  );

const settled = () => new Promise(resolve => setTimeout(resolve, 20));

describe('committing a transition', () => {
  it('writes the offering and its announcement together, and drains it at once', async () => {
    const w = world({
      [OFFERING_COLLECTION]: [{ id: 'o-1', status: 'draft' }],
    });

    const outcome = await w.run(
      Effect.flatMap(OfferingCatalogTag, catalog =>
        catalog.commitTransition(
          'acme',
          offering('published'),
          'draft',
          publicationEvent(),
        ),
      ),
    );
    await settled();

    expect(outcome).toBe('committed');
    expect(w.fake.read(OFFERING_COLLECTION)[0]?.['status']).toBe('published');
    expect(w.bus.published.map(event => event.name)).toEqual([
      'catalog.published',
    ]);
  });

  it('writes nothing, announcement included, when another transition moved it first', async () => {
    // ⚠️ The race #371 names: both read `draft`, the first wrote `published`.
    const w = world({
      [OFFERING_COLLECTION]: [{ id: 'o-1', status: 'published' }],
    });

    const outcome = await w.run(
      Effect.flatMap(OfferingCatalogTag, catalog =>
        catalog.commitTransition(
          'acme',
          offering('unpublished'),
          'draft',
          publicationEvent(),
        ),
      ),
    );

    expect(outcome).toBe('changed');
    expect(w.fake.read(OUTBOX_COLLECTION)).toEqual([]);
  });

  it('reports a write the driver failed as a store failure', async () => {
    const w = world({
      [OFFERING_COLLECTION]: [{ id: 'o-1', status: 'draft' }],
    });
    w.fake.failOn('replaceOne', new Error('network down'));

    await expect(
      w.run(
        Effect.flatMap(OfferingCatalogTag, catalog =>
          catalog.commitTransition(
            'acme',
            offering('published'),
            'draft',
            publicationEvent(),
          ),
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('re-announcing', () => {
  it('enqueues once, and knows what the outbox already holds', async () => {
    // Two calls in one layer, so the second finds its indexes ensured.
    const outcomes = await world().run(
      Effect.flatMap(OfferingCatalogTag, catalog =>
        Effect.zip(
          catalog.reannounce('acme', publicationEvent()),
          catalog.reannounce('acme', publicationEvent()),
        ),
      ),
    );

    expect(outcomes).toEqual(['announced', 'alreadyAnnounced']);
  });

  it('gives a quarantined announcement another life', async () => {
    const event = publicationEvent();
    const w = world({
      [OUTBOX_COLLECTION]: [
        { eventId: event.id, sent: true, quarantined: true, attempts: 3 },
      ],
    });

    const revived = await w.run(
      Effect.flatMap(OfferingCatalogTag, catalog =>
        catalog.reannounce('acme', event),
      ),
    );

    expect(revived).toBe('revived');
  });
});

describe('creating a specification', () => {
  const named = (name: string) =>
    Object.assign(new ProductSpecification(), { name });

  const create = (
    w: ReturnType<typeof world>,
    name: string,
    key: string | undefined,
  ) =>
    w.run(
      Effect.flatMap(SpecificationCommandsTag, commands =>
        commands.create('acme', named(name), key),
      ),
    );

  it('writes the record under the next code, with the counter, in one unit', async () => {
    const w = world();

    const first = await create(w, 'A widget', undefined);
    const second = await create(w, 'A gadget', undefined);

    expect([first.code, second.code]).toEqual(['product-001', 'product-002']);
    expect(w.fake.read(SPECIFICATION_COLLECTION)).toEqual([
      expect.objectContaining({ id: first.id, name: 'A widget' }),
      expect.objectContaining({ id: second.id, name: 'A gadget' }),
    ]);
    expect(w.fake.read(COUNTERS_COLLECTION)).toEqual([
      expect.objectContaining({ _id: 'specification-code', value: 2 }),
    ]);
  });

  it('answers a repeated key with the record it wrote, spending no code', async () => {
    const w = world();

    const first = await create(w, 'A widget', 'key-1');
    const again = await create(w, 'A widget', 'key-1');

    expect(again).toBeInstanceOf(ProductSpecification);
    expect(again).toMatchObject({ id: first.id, code: 'product-001' });
    expect(w.fake.read(SPECIFICATION_COLLECTION)).toHaveLength(1);
  });

  it('fails as the store when the answer it stored will not revive', async () => {
    // A command already claimed, whose stored answer is not a record.
    const w = world({
      command_inbox: [
        {
          commandId: 'key-2',
          claimedAt: new Date().toISOString(),
          replay: 'not a record',
        },
      ],
    });

    const failure = await w.run(
      Effect.flip(
        Effect.flatMap(SpecificationCommandsTag, commands =>
          commands.create('acme', named('A widget'), 'key-2'),
        ),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'Unavailable', dependency: 'mongo' });
  });

  it('writes nothing and spends no code when the record cannot be written', async () => {
    const w = world();
    w.fake.failOn('insertOne', new Error('disk full'));

    const failure = await w.run(
      Effect.flip(
        Effect.flatMap(SpecificationCommandsTag, commands =>
          commands.create('acme', named('A widget'), undefined),
        ),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'Unavailable' });
    expect(w.fake.read(SPECIFICATION_COLLECTION)).toEqual([]);
  });
});
