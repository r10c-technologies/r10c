import { ShutdownRegistryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  type ShippingOrderStore,
  ShippingOrderStoreTag,
} from '@r10c/business-ts-shipping-order-management';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  DestinationRetentionDays,
  startDestinationRedactionSweep,
  sweepClosedDestinations,
} from './destination-redaction-sweep.js';

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

const storeThat = (
  redactClosedBefore: ShippingOrderStore['redactClosedBefore'],
) =>
  ({ redactClosedBefore }) as unknown as ShippingOrderStore;

const pass = (store: ShippingOrderStore, days = 30) =>
  sweepClosedDestinations.pipe(
    Effect.provideService(ShippingOrderStoreTag, store),
    Effect.provideService(DestinationRetentionDays, days),
  );

describe('one destination sweep pass', () => {
  it('counts the dial back from now, and logs each failure and the total', async () => {
    let bounds: { before: Date; at: Date } | undefined;
    const logged = await logs(
      pass(
        storeThat((before, at) => {
          bounds = { before, at };
          return Effect.succeed({
            redacted: 2,
            failed: [
              {
                database: 'fulfilment_a',
                shippingOrderId: 's-1',
                failure: new Unavailable({ dependency: 'mongo' }),
              },
            ],
          });
        }),
        7,
      ),
    );

    expect(
      (bounds?.at.getTime() ?? 0) - (bounds?.before.getTime() ?? 0),
    ).toBe(7 * 86_400_000);
    expect(logged.map(entry => entry.level)).toEqual(['Error', 'Debug']);
    expect(logged[0]?.annotations).toMatchObject({
      database: 'fulfilment_a',
      shippingOrderId: 's-1',
      code: 'unavailable',
    });
    expect(logged[1]?.annotations).toEqual({ redacted: 2 });
  });

  it('logs nothing for a pass with nothing to do', async () => {
    expect(
      await logs(
        pass(storeThat(() => Effect.succeed({ redacted: 0, failed: [] }))),
      ),
    ).toEqual([]);
  });

  it('logs a pass that could not run, and does not fail', async () => {
    const logged = await logs(
      pass(storeThat(() => Effect.fail(new Unavailable({})))),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable' },
    });
  });
});

describe('the destination sweep daemon', () => {
  it('registers itself to stop after the handlers, and stops', async () => {
    const hooks: Hook[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startDestinationRedactionSweep;
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(
          ShippingOrderStoreTag,
          storeThat(() => Effect.succeed({ redacted: 0, failed: [] })),
        ),
        Effect.provideService(DestinationRetentionDays, 30),
        Effect.provideService(ShutdownRegistryTag, registry(hooks)),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['destination-redaction-sweep', 'flush'],
    ]);
  });
});
