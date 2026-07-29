import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { MongoDatabaseTag } from './mongo-database.js';
import {
  MONGO_PROBE_NAME,
  MongoHealthProbeLayer,
} from './mongo-health-probe.js';

/** A `Db` stub whose `admin().ping()` behaves as the test dictates. */
const dbWithPing = (ping: () => Promise<unknown>) =>
  ({ admin: () => ({ ping }) }) as unknown as Db;

const reportWith = (db: Db): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        MongoHealthProbeLayer.pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(Layer.succeed(MongoDatabaseTag, db)),
        ),
      ),
    ),
  );

describe('MongoHealthProbeLayer', () => {
  it('reports ready when the ping round-trips', async () => {
    const report = await reportWith(
      dbWithPing(() => Promise.resolve({ ok: 1 })),
    );

    expect(report).toEqual({ ready: true, failing: [] });
  });

  it('reports the probe as failing when the ping rejects', async () => {
    const report = await reportWith(
      dbWithPing(() => Promise.reject(new Error('no primary'))),
    );

    expect(report).toEqual({ ready: false, failing: [MONGO_PROBE_NAME] });
  });
});
