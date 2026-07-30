import { SqlClient } from '@effect/sql';
import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import {
  type FakeSqlClient,
  makeFakeSqlClient,
} from '@r10c/entifix-ts-testing-unit/drivers';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { SQL_PROBE_NAME, SqlHealthProbeLayer } from './sql-health-probe.js';

/** Builds the probe over `fake`, so the spec controls whether `SELECT 1` works. */
const reportOver = (fake: FakeSqlClient): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        SqlHealthProbeLayer.pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(
            Layer.succeed(
              SqlClient.SqlClient,
              fake.client as SqlClient.SqlClient,
            ),
          ),
        ),
      ),
    ),
  );

describe('SqlHealthProbeLayer', () => {
  it('reports ready when `SELECT 1` round-trips', async () => {
    const report = await reportOver(makeFakeSqlClient());

    expect(report).toEqual({ ready: true, failing: [] });
  });

  it('reports the probe as failing when the query errors', async () => {
    const fake = makeFakeSqlClient();
    fake.failWith('connection terminated');

    const report = await reportOver(fake);

    expect(report).toEqual({ ready: false, failing: [SQL_PROBE_NAME] });
  });

  it('crosses the wire rather than inspecting the pool object', async () => {
    // A pool survives a database that has gone away, so the probe is only
    // meaningful if it actually executes something.
    const fake = makeFakeSqlClient();

    await reportOver(fake);

    expect(fake.lastExecution?.sql).toBe('SELECT 1');
  });
});
