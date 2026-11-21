import { ShutdownRegistryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  type ObjectStore,
  ObjectStoreTag,
} from '@r10c/business-ts-object-storage';
import { makeInMemoryObjectStore } from '@r10c/business-ts-object-storage/testing';
import { ProductOrderStoreTag } from '@r10c/business-ts-order-management';
import { makeInMemoryOrderStores } from '@r10c/business-ts-order-management/testing';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ORPHAN_GRACE_MS,
  startEvidenceOrphanSweep,
  sweepOrphans,
} from './evidence-orphan-sweep.js';

const logs = async (objects: ObjectStore) => {
  const logged: { level: string; annotations: Record<string, unknown> }[] = [];
  await Effect.runPromise(
    sweepOrphans.pipe(
      Effect.provideService(ObjectStoreTag, objects),
      Effect.provideService(
        ProductOrderStoreTag,
        makeInMemoryOrderStores().orders,
      ),
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, fiber }) => {
            logged.push({
              level: logLevel,
              annotations: {
                ...fiber.getRef(References.CurrentLogAnnotations),
              },
            });
          }),
        ]),
      ),
      Effect.provideService(References.MinimumLogLevel, 'All'),
    ),
  );
  return logged;
};

describe('one orphan sweep pass', () => {
  it('deletes a file no order points at once its grace passed, and says how many', async () => {
    const old = new Date(Date.now() - 2 * ORPHAN_GRACE_MS);
    const objects = makeInMemoryObjectStore(() => old);
    await Effect.runPromise(
      objects.put('evidence/o-1/e-1', new Uint8Array([1]), 'image/png'),
    );

    expect(await logs(objects)).toEqual([
      { level: 'Debug', annotations: { deleted: 1 } },
    ]);
    expect(objects.keys()).toEqual([]);
  });

  it('logs nothing with nothing to delete, and logs a pass that failed', async () => {
    expect(await logs(makeInMemoryObjectStore())).toEqual([]);
    const failing = {
      ...makeInMemoryObjectStore(),
      list: () => Effect.fail(new Unavailable({})),
    };

    expect(await logs(failing)).toMatchObject([
      { level: 'Error', annotations: { code: 'unavailable' } },
    ]);
  });
});

describe('the orphan sweep daemon', () => {
  it('registers itself to stop after the handlers, and stops', async () => {
    const hooks: {
      name: string;
      phase: string;
      run: Effect.Effect<unknown>;
    }[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startEvidenceOrphanSweep(60_000);
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(ObjectStoreTag, makeInMemoryObjectStore()),
        Effect.provideService(
          ProductOrderStoreTag,
          makeInMemoryOrderStores().orders,
        ),
        Effect.provideService(ShutdownRegistryTag, {
          register: (hook: never) =>
            Effect.sync(() => {
              hooks.push(hook);
            }),
        } as never),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['evidence-orphan-sweep', 'flush'],
    ]);
  });
});
