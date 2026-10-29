import { generateKeyPairSync } from 'node:crypto';

import { ShutdownRegistryTag } from '@entifix/business';
import type { DomainEvent } from '@entifix/core';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import {
  EventBusTag,
  SagaDispatcherTag,
  SagaStoreTag,
  TransactionStoreTag,
  TransactionStreamHubTag,
} from '@entifix/transactions';
import { TransactionFoldTag } from '@r10c/business-ts-saga-contracts';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAppLayer, router, transactionComposition } from './index.js';
import {
  SagaMaxResumeAttempts,
  SagaResumeIntervalMs,
  SagaStaleAfterMs,
  startSagaResume,
} from './saga/resume.js';
import {
  SagaRecoveryIntervalMs,
  SagaStaleTimeoutMs,
  startTracking,
} from './saga/tracking.js';

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
    staleTimeoutMs: 60_000,
    recoveryIntervalMs: 60_000,
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

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer())).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
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

describe('the tracker', () => {
  it('folds each transaction event, streams it, and stops its sweep on shutdown', async () => {
    const bus = makeRecordingEventBus();
    const folded: string[] = [];
    const streamed: string[] = [];
    const hooks: Hook[] = [];
    const event: DomainEvent = {
      name: 'transaction.completed',
      id: 'transaction.completed:1',
      source: 'marketplace-admin',
      at: '2026-10-25T12:00:00.000Z',
      correlationId: 't-1',
      data: { transactionId: 't-1' },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startTracking;
        // Lazily: the double picks its subscribers when `deliver` is called.
        yield* Effect.suspend(() => bus.deliver(event));
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(EventBusTag, bus),
            Layer.succeed(TransactionStoreTag, {
              findStale: () => Effect.succeed([]),
              countByState: () =>
                Effect.succeed({
                  PENDING: 0,
                  COMPLETED: 0,
                  FAILED: 0,
                  STALE: 0,
                }),
            } as never),
            Layer.succeed(TransactionStreamHubTag, {
              publish: (published: DomainEvent) =>
                Effect.sync(() => {
                  streamed.push(published.id);
                }),
            } as never),
            Layer.succeed(TransactionFoldTag, {
              fold: (_consumer: string, eventId: string) =>
                Effect.sync(() => {
                  folded.push(eventId);
                  return 'folded';
                }),
            } as never),
            Layer.succeed(SagaRecoveryIntervalMs, 60_000),
            Layer.succeed(SagaStaleTimeoutMs, 60_000),
            shutdownRecording(hooks),
          ),
        ),
      ),
    );

    expect(folded).toEqual(['transaction.completed:1']);
    expect(streamed).toEqual(['transaction.completed:1']);
    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['saga-recovery-sweep', 'stop-intake'],
    ]);
  });
});

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
