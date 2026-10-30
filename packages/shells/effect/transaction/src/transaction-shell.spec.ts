import { generateKeyPairSync } from 'node:crypto';

import { ShutdownRegistryTag } from '@entifix/business';
import { SagaDispatcherTag, SagaStoreTag } from '@entifix/transactions';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAppLayer, transactionComposition } from './index.js';
import {
  SagaMaxResumeAttempts,
  SagaResumeIntervalMs,
  SagaStaleAfterMs,
  startSagaResume,
} from './saga/resume.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  service: configurationRows({ token: 'spec-crossing-token' }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
  }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  idempotency: configurationRows({ retentionMs: 60_000 }),
  saga: configurationRows({
    db: 'saga',
    resumeIntervalMs: 60_000,
    resumeStaleAfterMs: 60_000,
    maxResumeAttempts: 3,
  }),
  participant: configurationRows({
    stockUrl: 'http://stock.invalid/api',
    stockToken: 'stock-token',
    orderUrl: 'http://order.invalid/api',
    orderToken: 'order-token',
    paymentUrl: 'http://payment.invalid/api',
    paymentToken: 'payment-token',
  }),
});

describe('the transaction shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      transactionComposition(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration that names no participant, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      transactionComposition(
        fleetConfigurationOf({ ...CONFIGURATION.plain, participant: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition as a layer', () => {
    expect(Layer.isLayer(makeAppLayer())).toBe(true);
  });
});

interface Hook {
  readonly name: string;
  readonly phase: string;
  readonly run: Effect.Effect<unknown>;
}

const shutdownRecording = (hooks: Hook[]) =>
  Layer.succeed(ShutdownRegistryTag, {
    register: (hook: Hook) =>
      Effect.sync(() => {
        hooks.push(hook);
      }),
  } as never);

describe('the resume daemon', () => {
  it('registers to stop before intake ends, and stops', async () => {
    const hooks: Hook[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startSagaResume;
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SagaStoreTag, {
              findStale: () => Effect.succeed([]),
            } as never),
            Layer.succeed(SagaDispatcherTag, {} as never),
            Layer.succeed(SagaResumeIntervalMs, 60_000),
            Layer.succeed(SagaStaleAfterMs, 60_000),
            Layer.succeed(SagaMaxResumeAttempts, 3),
            shutdownRecording(hooks),
          ),
        ),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['saga-resume-sweep', 'stop-intake'],
    ]);
  });
});
