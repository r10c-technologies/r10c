import { ShutdownRegistryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  type CourierTracking,
  CourierTrackingTag,
  type ShippingOrderStore,
  ShippingOrderStoreTag,
} from '@r10c/business-ts-shipping-order-management';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import { pollCourierFeed, startCourierFeed } from './courier-feed-sweep.js';

interface Logged {
  readonly level: string;
  readonly annotations: Record<string, unknown>;
}

const logs = async <E>(pass: Effect.Effect<void, E>): Promise<Logged[]> => {
  const logged: Logged[] = [];
  await Effect.runPromise(
    pass.pipe(
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
    ) as Effect.Effect<void>,
  );
  return logged;
};

type Hook = { name: string; phase: string; run: Effect.Effect<unknown> };

const registry = (hooks: Hook[]) =>
  ({
    register: (hook: Hook) =>
      Effect.sync(() => {
        hooks.push(hook);
      }),
  }) as never;

const PARCEL = {
  organizationId: 'org-1',
  shippingOrderId: 's-1',
  courierKey: 'other',
  trackingNumber: 'G-1',
  dispatchedAt: new Date('2026-11-19T10:00:00.000Z'),
};

const storeWith = (
  inTransit: ShippingOrderStore['inTransit'],
): ShippingOrderStore =>
  ({
    inTransit,
    transition: () => Effect.succeed({}),
  }) as unknown as ShippingOrderStore;

const DELIVERS: CourierTracking = {
  reports: parcels =>
    Effect.succeed(
      parcels.map(parcel => ({
        ...parcel,
        outcome: 'delivered' as const,
        at: parcel.dispatchedAt,
      })),
    ),
};

const pass = (store: ShippingOrderStore) =>
  pollCourierFeed.pipe(
    Effect.provideService(ShippingOrderStoreTag, store),
    Effect.provideService(CourierTrackingTag, DELIVERS),
  );

describe('one courier feed pass', () => {
  it('logs how many reports it applied', async () => {
    const logged = await logs(pass(storeWith(() => Effect.succeed([PARCEL]))));

    expect(logged).toEqual([{ level: 'Debug', annotations: { applied: 1 } }]);
  });

  it('logs nothing for a pass with nothing in transit', async () => {
    expect(await logs(pass(storeWith(() => Effect.succeed([]))))).toEqual([]);
  });

  it('logs a pass that could not run, and does not fail', async () => {
    const logged = await logs(
      pass(storeWith(() => Effect.fail(new Unavailable({})))),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable' },
    });
  });
});

describe('the courier feed daemon', () => {
  it('registers itself to stop after the handlers, and stops', async () => {
    const hooks: Hook[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startCourierFeed;
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(
          ShippingOrderStoreTag,
          storeWith(() => Effect.succeed([])),
        ),
        Effect.provideService(CourierTrackingTag, DELIVERS),
        Effect.provideService(ShutdownRegistryTag, registry(hooks)),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['courier-feed', 'flush'],
    ]);
  });
});
