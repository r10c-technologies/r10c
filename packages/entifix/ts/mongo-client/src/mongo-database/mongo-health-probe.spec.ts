import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';
import type { MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';

import { MongoClientTag } from './mongo-database.js';
import {
  MONGO_PROBE_NAME,
  MongoHealthProbeLayer,
} from './mongo-health-probe.js';

/** A `MongoClient` stub whose `db(name).command()` behaves as the test dictates. */
const clientWithCommand = (command: () => Promise<unknown>) => {
  const db = vi.fn(() => ({ command }));
  return { client: { db } as unknown as MongoClient, db };
};

const reportWith = (client: MongoClient): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        MongoHealthProbeLayer.pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(Layer.succeed(MongoClientTag, client)),
        ),
      ),
    ),
  );

describe('MongoHealthProbeLayer', () => {
  it('reports ready when the ping round-trips', async () => {
    const { client } = clientWithCommand(() => Promise.resolve({ ok: 1 }));

    const report = await reportWith(client);

    expect(report).toEqual({ ready: true, failing: [] });
  });

  it('reports the probe as failing when the ping rejects', async () => {
    const { client } = clientWithCommand(() =>
      Promise.reject(new Error('no primary')),
    );

    const report = await reportWith(client);

    expect(report).toEqual({ ready: false, failing: [MONGO_PROBE_NAME] });
  });

  // The reason the probe takes the client rather than a named database: it must
  // stay usable by a service that names no store at boot (tenant storage), so it
  // may never reach for whatever database the connection happens to point at.
  it('pings the admin database, never the connected one', async () => {
    const { client, db } = clientWithCommand(() => Promise.resolve({ ok: 1 }));

    await reportWith(client);

    expect(db).toHaveBeenCalledWith('admin');
  });
});
