import { IdempotencyStoreTag } from '@entifix/business';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect, Layer } from 'effect';
import type { Db, MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  configurationRows,
  fleetConfigurationOf,
} from './fleet-configuration.js';
import { fleetIdempotencyLayer } from './fleet-idempotency.js';

const configuration = fleetConfigurationOf({
  idempotency: configurationRows({ retentionMs: 60_000 }),
});

const claimThrough = (layer: Layer.Layer<IdempotencyStoreTag, unknown>) =>
  Effect.runPromise(
    Effect.flatMap(IdempotencyStoreTag, store => store.claim('k', 'f')).pipe(
      Effect.provide(layer),
    ),
  );

describe('fleetIdempotencyLayer', () => {
  it("keeps the records in the service's own database by default", async () => {
    const fake = makeFakeMongoDb();
    const layer = Effect.runSync(fleetIdempotencyLayer(configuration)).pipe(
      Layer.provide(Layer.succeed(MongoDatabaseTag, fake.db as Db)),
    );

    expect(await claimThrough(layer)).toEqual({ _tag: 'claimed' });
    expect(fake.read('idempotency')).toHaveLength(1);
  });

  it('keeps them in a named database on the pool when asked to', async () => {
    const fake = makeFakeMongoDb();
    const opened: string[] = [];
    const client = {
      db: (name: string) => {
        opened.push(name);
        return fake.db;
      },
    } as unknown as MongoClient;
    const layer = Effect.runSync(
      fleetIdempotencyLayer(configuration, 'stock-idempotency'),
    ).pipe(Layer.provide(Layer.succeed(MongoClientTag, client)));

    expect(await claimThrough(layer)).toEqual({ _tag: 'claimed' });
    expect(opened).toEqual(['stock-idempotency']);
  });
});
