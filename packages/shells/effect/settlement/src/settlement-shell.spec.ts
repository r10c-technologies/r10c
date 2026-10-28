import { generateKeyPairSync } from 'node:crypto';

import { ShutdownRegistryTag } from '@entifix/business';
import { type DomainEvent, Unavailable } from '@entifix/core';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { EventBusTag } from '@entifix/transactions';
import {
  type FoldReport,
  type SaleJoin,
  SaleJoinTag,
  type SettlementRunStore,
  SettlementRunStoreTag,
} from '@r10c/business-ts-settlement-management';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ensureBusIndexes,
  logFoldReport,
  makeAppLayer,
  router,
  settlementComposition,
  SettlementRunIntervalMs,
  settleOncePass,
  startSettlementFold,
  startSettlementSweep,
} from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
    db: 'settlement',
  }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  outbox: configurationRows({ maxAttempts: 4 }),
  tenant: configurationRows({ demoOrganizationId: 'demo' }),
  settlement: configurationRows({ runIntervalMs: 60_000 }),
});

const seed = () => Effect.void;

interface Logged {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Record<string, unknown>;
}

const logsOf = async <E>(
  effect: Effect.Effect<unknown, E>,
): Promise<Logged[]> => {
  const logged: Logged[] = [];
  await Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, message, fiber }) => {
            logged.push({
              level: logLevel,
              message,
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

describe('the settlement shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      settlementComposition({ seed })(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no run interval, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      settlementComposition({ seed })(
        fleetConfigurationOf({ ...CONFIGURATION.plain, settlement: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('indexes the outbox and the inbox before either is written', async () => {
    const fake = makeFakeMongoDb();

    await Effect.runPromise(ensureBusIndexes(fake.db as never));

    expect(
      fake.operations.filter(operation => operation.op === 'createIndex'),
    ).not.toEqual([]);
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer({ seed }))).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});

describe('logFoldReport', () => {
  const report = (
    outcome: FoldReport['outcome'],
    unpriced: string[] = [],
  ): FoldReport => ({
    event: 'order.placed',
    orderId: 'o-1',
    outcome,
    unpriced,
  });

  it('names each outcome, and an unpriced vendor as an error', async () => {
    const logged = await logsOf(
      Effect.forEach(
        [
          report({ kind: 'written', folded: 2, reversed: 1 }, ['v-2']),
          report({ kind: 'written', folded: 0, reversed: 0 }),
          report({ kind: 'duplicate' }),
          report({ kind: 'waiting' }),
        ],
        logFoldReport,
      ),
    );

    expect(
      logged.map(entry => [entry.level, entry.annotations['outcome']]),
    ).toEqual([
      ['Error', undefined],
      ['Info', 'folded'],
      ['Info', 'reversed'],
      ['Debug', 'alreadyApplied'],
      ['Debug', 'awaitingPair'],
    ]);
    expect(logged[0]?.annotations).toMatchObject({ vendors: ['v-2'] });
  });
});

describe('the settlement fold', () => {
  it('folds each of its four messages and logs what the fold did', async () => {
    const bus = makeRecordingEventBus();
    const join = {
      agreementsFor: () => Effect.succeed(new Map()),
      contribute: () => Effect.succeed({ kind: 'waiting' as const }),
    } as unknown as SaleJoin;
    const captured: DomainEvent = {
      name: 'payment.captured',
      id: 'payment.captured:1',
      source: 'payment',
      at: '2026-10-25T12:00:00.000Z',
      correlationId: 'o-1',
      data: {
        paymentId: 'pay-1',
        orderId: 'o-1',
        amount: 40,
        currency: 'GTQ',
        paymentMethod: 'card',
        decidedAt: '2026-10-25T12:00:00.000Z',
      },
    };

    const logged = await logsOf(
      Effect.andThen(startSettlementFold, () => bus.deliver(captured)).pipe(
        Effect.provideService(EventBusTag, bus),
        Effect.provideService(SaleJoinTag, join),
      ),
    );

    expect(logged).toEqual([
      expect.objectContaining({
        annotations: expect.objectContaining({
          outcome: 'awaitingPair',
          event: 'payment.captured',
          orderId: 'o-1',
        }),
      }),
    ]);
  });
});

describe('one settlement pass', () => {
  const runsThat = (
    settleOnce: SettlementRunStore['settleOnce'],
  ): SettlementRunStore => ({ settleOnce }) as SettlementRunStore;
  const pass = (runs: SettlementRunStore) =>
    logsOf(
      settleOncePass.pipe(Effect.provideService(SettlementRunStoreTag, runs)),
    );

  it('logs a period it settled', async () => {
    const logged = await pass(
      runsThat(() =>
        Effect.succeed({
          kind: 'calculated',
          runId: 'run-1',
          periodStart: '2026-10-01T00:00:00.000Z',
          periodEnd: '2026-10-25T00:00:00.000Z',
          payouts: 2,
          entries: 3,
        }),
      ),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Info',
      annotations: { runId: 'run-1', payouts: 2 },
    });
  });

  it('logs nothing for an idle pass', async () => {
    expect(
      await pass(runsThat(() => Effect.succeed({ kind: 'idle' }))),
    ).toEqual([]);
  });

  it('logs a failed pass by code, and does not fail', async () => {
    const logged = await pass(runsThat(() => Effect.fail(new Unavailable({}))));

    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable', category: 'unavailable' },
    });
  });
});

describe('the settlement daemon', () => {
  it('registers itself to stop before intake ends, and stops', async () => {
    const hooks: Array<{
      name: string;
      phase: string;
      run: Effect.Effect<unknown>;
    }> = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startSettlementSweep;
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(SettlementRunStoreTag, {
          settleOnce: () => Effect.succeed({ kind: 'idle' }),
        } as unknown as SettlementRunStore),
        Effect.provideService(SettlementRunIntervalMs, 60_000),
        Effect.provideService(ShutdownRegistryTag, {
          register: (hook: (typeof hooks)[number]) =>
            Effect.sync(() => {
              hooks.push(hook);
            }),
        } as never),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['settlement-sweep', 'stop-intake'],
    ]);
  });
});
