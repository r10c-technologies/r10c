import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HealthProbe, HealthRegistry } from './health-registry.js';
import { HealthRegistryLayer, HealthRegistryTag } from './health-registry.js';

/**
 * A probe with the `kind`/`targets` these cases do not care about filled in.
 * Readiness ignores both; they exist for `GET /api/$service` (ADR 0031), and a
 * spec that spelled them out on every registration would be asserting they are
 * *not* consulted here by repeating them fifteen times.
 */
const probe = (name: string, check: HealthProbe['check']): HealthProbe => ({
  name,
  kind: 'datastore',
  targets: [name],
  check,
});

const withRegistry = <A>(
  body: (registry: HealthRegistry) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      return yield* body(registry);
    }).pipe(Effect.provide(HealthRegistryLayer)),
  );

describe('HealthRegistry', () => {
  it('reports ready when nothing has registered', async () => {
    const report = await withRegistry(registry => registry.report);

    expect(report).toEqual({ ready: true, failing: [] });
  });

  it('reports ready when every probe answers true', async () => {
    const report = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register(probe('mongo', Effect.succeed(true)));
        yield* registry.register(probe('redis', Effect.succeed(true)));
        return yield* registry.report;
      }),
    );

    expect(report).toEqual({ ready: true, failing: [] });
  });

  it('names every failing probe, in registration order', async () => {
    const report = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register(probe('mongo', Effect.succeed(false)));
        yield* registry.register(probe('redis', Effect.succeed(true)));
        yield* registry.register(probe('amqp', Effect.succeed(false)));
        return yield* registry.report;
      }),
    );

    expect(report).toEqual({ ready: false, failing: ['mongo', 'amqp'] });
  });

  // The case that made the timeout necessary: with Redis scaled to zero,
  // ioredis queued the PING instead of rejecting it, and readiness hung.
  it('fails a probe that never answers, rather than hanging', async () => {
    const report = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register(probe('wedged', Effect.never));
        return yield* registry.report;
      }),
    );

    expect(report).toEqual({ ready: false, failing: ['wedged'] });
  }, 10_000);

  // A probe that throws must not take down the endpoint that exists to report
  // trouble — it counts as a failing probe like any other.
  it('treats a defect inside a probe as a failure', async () => {
    const report = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register(
          probe(
            'exploding',
            Effect.sync(() => {
              throw new Error('driver blew up');
            }),
          ),
        );
        return yield* registry.report;
      }),
    );

    expect(report).toEqual({ ready: false, failing: ['exploding'] });
  });

  /**
   * `probes` is what makes readiness and `GET /api/$service` generate from one
   * registration instead of from two lists that drift (ADR 0031).
   */
  it('reads the registrations back, in registration order', async () => {
    const registered = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register({
          name: 'mongo',
          kind: 'datastore',
          targets: ['catalog', 'saga'],
          check: Effect.succeed(true),
        });
        yield* registry.register({
          name: 'amqp',
          kind: 'broker',
          targets: ['entifix.events'],
          check: Effect.succeed(true),
        });
        return yield* registry.probes;
      }),
    );

    expect(
      registered.map(({ name, kind, targets }) => ({ name, kind, targets })),
    ).toEqual([
      { name: 'mongo', kind: 'datastore', targets: ['catalog', 'saga'] },
      { name: 'amqp', kind: 'broker', targets: ['entifix.events'] },
    ]);
  });

  // Describing a service must never cost a round trip to every datastore it has.
  it('runs no probe when the registrations are read', async () => {
    let ran = 0;
    const registered = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register(
          probe(
            'counted',
            Effect.sync(() => {
              ran += 1;
              return true;
            }),
          ),
        );
        return yield* registry.probes;
      }),
    );

    expect(registered).toHaveLength(1);
    expect(ran).toBe(0);
  });

  it('reads back nothing when nothing has registered', async () => {
    expect(await withRegistry(registry => registry.probes)).toEqual([]);
  });
});
