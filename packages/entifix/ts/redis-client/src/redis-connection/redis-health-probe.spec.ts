import type { HealthReport } from '@r10c/entifix-ts-business';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { RedisTag } from './redis-connection.js';
import {
  REDIS_PROBE_NAME,
  RedisHealthProbeLayer,
} from './redis-health-probe.js';

const redisWithPing = (ping: () => Promise<string>) =>
  ({ ping }) as unknown as Redis;

const reportWith = (redis: Redis): Promise<HealthReport> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.report;
    }).pipe(
      Effect.provide(
        RedisHealthProbeLayer(['session']).pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(Layer.succeed(RedisTag, redis)),
        ),
      ),
    ),
  );

/** The registrations themselves, without running any of them. */
const probesWith = (redis: Redis) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* registry.probes;
    }).pipe(
      Effect.provide(
        RedisHealthProbeLayer(['session']).pipe(
          Layer.provideMerge(HealthRegistryLayer),
          Layer.provideMerge(Layer.succeed(RedisTag, redis)),
        ),
      ),
    ),
  );

describe('RedisHealthProbeLayer', () => {
  it('reports ready on PONG', async () => {
    const report = await reportWith(
      redisWithPing(() => Promise.resolve('PONG')),
    );

    expect(report).toEqual({ ready: true, failing: [] });
  });

  // A reply that is not PONG means we are talking to something, but not to a
  // healthy Redis — a loaded-but-not-ready instance, or the wrong port.
  it('reports failing when the reply is not PONG', async () => {
    const report = await reportWith(
      redisWithPing(() => Promise.resolve('LOADING')),
    );

    expect(report).toEqual({ ready: false, failing: [REDIS_PROBE_NAME] });
  });

  it('reports failing when the ping rejects', async () => {
    const report = await reportWith(
      redisWithPing(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    expect(report).toEqual({ ready: false, failing: [REDIS_PROBE_NAME] });
  });
  // What `GET /api/$service` reports (ADR 0031) — a Store's register name, never
  // the Redis URI.
  it('declares the stores it was given, as a datastore', async () => {
    const probes = await probesWith(
      redisWithPing(() => Promise.resolve('PONG')),
    );

    expect(
      probes.map(({ name, kind, targets }) => ({ name, kind, targets })),
    ).toEqual([
      { name: REDIS_PROBE_NAME, kind: 'datastore', targets: ['session'] },
    ]);
  });
});
