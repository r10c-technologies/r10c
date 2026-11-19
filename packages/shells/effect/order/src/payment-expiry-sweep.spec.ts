import { ShutdownRegistryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  startPaymentExpirySweep,
  sweepOverduePayments,
} from './payment-expiry-sweep.js';

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

/** A store with `overdue` orders waiting, each of which an expiry wins. */
const ordersThat = (
  overduePayments: ProductOrderStore['overduePayments'],
): ProductOrderStore =>
  ({
    overduePayments,
    endAwaitingPayment: (orderId: string) => Effect.succeed({ id: orderId }),
  }) as unknown as ProductOrderStore;

const pass = (orders: ProductOrderStore) =>
  sweepOverduePayments.pipe(Effect.provideService(ProductOrderStoreTag, orders));

describe('one payment-expiry sweep pass', () => {
  it('logs how many unpaid orders it expired', async () => {
    const logged = await logs(
      pass(ordersThat(() => Effect.succeed(['o-1', 'o-2']))),
    );

    expect(logged).toEqual([{ level: 'Debug', annotations: { expired: 2 } }]);
  });

  it('logs nothing for a pass with nothing to do', async () => {
    expect(await logs(pass(ordersThat(() => Effect.succeed([]))))).toEqual(
      [],
    );
  });

  it('logs a pass that could not run, and does not fail', async () => {
    const logged = await logs(
      pass(ordersThat(() => Effect.fail(new Unavailable({})))),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable' },
    });
  });
});

describe('the payment-expiry sweep daemon', () => {
  it('registers itself to stop after the handlers, and stops', async () => {
    const hooks: Hook[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startPaymentExpirySweep(60_000);
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(
          ProductOrderStoreTag,
          ordersThat(() => Effect.succeed([])),
        ),
        Effect.provideService(ShutdownRegistryTag, registry(hooks)),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['payment-expiry-sweep', 'flush'],
    ]);
  });
});
