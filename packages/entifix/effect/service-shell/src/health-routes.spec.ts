import { HttpRouter } from '@effect/platform';
import type { ShutdownRegistry } from '@r10c/entifix-ts-business';
import {
  HealthRegistryTag,
  ShutdownRegistryTag,
} from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { RunningTestService } from './serve-test-service.js';
import { serveTestService } from './serve-test-service.js';

const SERVICE_NAME = '@r10c/probe-test-service';

let running: RunningTestService | undefined;

/**
 * Boots the real `makeServerLayer` wiring with a layer that registers the given
 * probes — the same path a `-service` takes, minus the infrastructure.
 */
const serveWithProbes = async (probes: ReadonlyArray<[string, boolean]>) => {
  const registerProbes = Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* HealthRegistryTag;
      for (const [name, ok] of probes) {
        // `kind`/`targets` are for `GET /api/$service`; readiness ignores both,
        // which is what these cases exist to keep true.
        yield* registry.register({
          name,
          kind: 'datastore',
          targets: [name],
          check: Effect.succeed(ok),
        });
      }
    }),
  );

  running = await serveTestService({
    name: SERVICE_NAME,
    port: 0,
    slices: ['test'],
    router: HttpRouter.empty,
    appLayer: registerProbes,
  });
  return running.baseUrl;
};

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('withHealthRoutes', () => {
  it('keeps /api/health answering as it always did', async () => {
    const baseUrl = await serveWithProbes([]);

    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: SERVICE_NAME,
    });
  });

  // Liveness must not consult a single dependency: a probe that fails when
  // Mongo blips is a probe that gets every replica restarted.
  it('answers liveness while a dependency is down', async () => {
    const baseUrl = await serveWithProbes([['mongo', false]]);

    const response = await fetch(`${baseUrl}/api/health/live`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'live',
      service: SERVICE_NAME,
    });
  });

  it('reports ready when every probe passes', async () => {
    const baseUrl = await serveWithProbes([
      ['mongo', true],
      ['redis', true],
    ]);

    const response = await fetch(`${baseUrl}/api/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      service: SERVICE_NAME,
    });
  });

  it('answers 503 naming the failing probes', async () => {
    const baseUrl = await serveWithProbes([
      ['mongo', true],
      ['redis', false],
      ['amqp', false],
    ]);

    const response = await fetch(`${baseUrl}/api/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'degraded',
      service: SERVICE_NAME,
      failing: ['redis', 'amqp'],
    });
  });

  // The cache is what keeps an unauthenticated endpoint from turning into a
  // free lever on the datastore; a second call inside the window must not run
  // the probes again.
  it('serves a repeat request from the cache', async () => {
    let runs = 0;
    const countingProbe = Layer.effectDiscard(
      Effect.gen(function* () {
        const registry = yield* HealthRegistryTag;
        yield* registry.register({
          name: 'counted',
          kind: 'datastore',
          targets: ['counted'],
          check: Effect.sync(() => {
            runs += 1;
            return true;
          }),
        });
      }),
    );

    running = await serveTestService({
      name: SERVICE_NAME,
      port: 0,
      slices: ['test'],
      router: HttpRouter.empty,
      appLayer: countingProbe,
    });

    await fetch(`${running.baseUrl}/api/health/ready`);
    await fetch(`${running.baseUrl}/api/health/ready`);

    expect(runs).toBe(1);
  });

  // A terminating process is not a degraded one, and the distinction is not
  // cosmetic: `failing: […]` is a list of probes an operator would go and look
  // at. Here nothing is failing — and the probes must not even be asked, or a
  // rolling restart spends a round trip per pod on an answer nobody acts on.
  it('answers 503 terminating once the drain has begun, without running a probe', async () => {
    let runs = 0;
    let shutdown: ShutdownRegistry | undefined;
    const appLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        shutdown = yield* ShutdownRegistryTag;
        const registry = yield* HealthRegistryTag;
        yield* registry.register({
          name: 'counted',
          kind: 'datastore',
          targets: ['counted'],
          check: Effect.sync(() => {
            runs += 1;
            return true;
          }),
        });
      }),
    );

    running = await serveTestService({
      name: SERVICE_NAME,
      port: 0,
      slices: ['test'],
      router: HttpRouter.empty,
      appLayer,
    });
    // What the `Layer` finalizer does on SIGTERM, minus the signal.
    await Effect.runPromise((shutdown as ShutdownRegistry).drain);

    const response = await fetch(`${running.baseUrl}/api/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'terminating',
      service: SERVICE_NAME,
    });
    expect(runs).toBe(0);
  });
});
