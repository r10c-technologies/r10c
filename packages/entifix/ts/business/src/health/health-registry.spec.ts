import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HealthRegistry } from './health-registry.js';
import { HealthRegistryLayer, HealthRegistryTag } from './health-registry.js';

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
        yield* registry.register({
          name: 'mongo',
          check: Effect.succeed(true),
        });
        yield* registry.register({
          name: 'redis',
          check: Effect.succeed(true),
        });
        return yield* registry.report;
      }),
    );

    expect(report).toEqual({ ready: true, failing: [] });
  });

  it('names every failing probe, in registration order', async () => {
    const report = await withRegistry(registry =>
      Effect.gen(function* () {
        yield* registry.register({
          name: 'mongo',
          check: Effect.succeed(false),
        });
        yield* registry.register({
          name: 'redis',
          check: Effect.succeed(true),
        });
        yield* registry.register({
          name: 'amqp',
          check: Effect.succeed(false),
        });
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
        yield* registry.register({
          name: 'wedged',
          check: Effect.never,
        });
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
        yield* registry.register({
          name: 'exploding',
          check: Effect.sync(() => {
            throw new Error('driver blew up');
          }),
        });
        return yield* registry.report;
      }),
    );

    expect(report).toEqual({ ready: false, failing: ['exploding'] });
  });
});
