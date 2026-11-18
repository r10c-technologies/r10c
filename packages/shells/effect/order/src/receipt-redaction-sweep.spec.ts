import { ShutdownRegistryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  type CheckoutGroupStore,
  CheckoutGroupStoreTag,
} from '@r10c/business-ts-order-management';
import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  startReceiptRedactionSweep,
  sweepEndedReceipts,
} from './receipt-redaction-sweep.js';

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

const groupsThat = (
  redactEndedReceipts: CheckoutGroupStore['redactEndedReceipts'],
) => ({ redactEndedReceipts }) as unknown as CheckoutGroupStore;

const pass = (groups: CheckoutGroupStore) =>
  sweepEndedReceipts.pipe(Effect.provideService(CheckoutGroupStoreTag, groups));

describe('one buyer-contact sweep pass', () => {
  it('logs how many contacts it removed', async () => {
    const logged = await logs(pass(groupsThat(() => Effect.succeed(2))));

    expect(logged).toEqual([{ level: 'Debug', annotations: { redacted: 2 } }]);
  });

  it('logs nothing for a pass with nothing to do', async () => {
    expect(await logs(pass(groupsThat(() => Effect.succeed(0))))).toEqual([]);
  });

  it('logs a pass that could not run, and does not fail', async () => {
    const logged = await logs(
      pass(groupsThat(() => Effect.fail(new Unavailable({})))),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable' },
    });
  });
});

describe('the buyer-contact sweep daemon', () => {
  it('registers itself to stop after the handlers, and stops', async () => {
    const hooks: Hook[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startReceiptRedactionSweep;
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(
          CheckoutGroupStoreTag,
          groupsThat(() => Effect.succeed(0)),
        ),
        Effect.provideService(ShutdownRegistryTag, registry(hooks)),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['receipt-redaction-sweep', 'flush'],
    ]);
  });
});
