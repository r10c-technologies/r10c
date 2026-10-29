import { generateKeyPairSync } from 'node:crypto';

import type { DomainEvent } from '@entifix/core';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { EventBusTag } from '@entifix/transactions';
import {
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  capturedSubscription,
  makeAppLayer,
  orderComposition,
  router,
} from './index.js';
import { startPaymentStatusProjection } from './payment-status.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  service: configurationRows({ token: 'spec-crossing-token' }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
    db: 'order',
  }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  outbox: configurationRows({ maxAttempts: 4 }),
  idempotency: configurationRows({ retentionMs: 60_000 }),
  order: configurationRows({ cancelWindowSeconds: 1800 }),
  transaction: configurationRows({
    url: 'http://coordinator.invalid/api',
    crossingToken: 'spec-coordinator-token',
  }),
});

describe('the order shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(orderComposition(CONFIGURATION));

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no cancel window, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      orderComposition(
        fleetConfigurationOf({ ...CONFIGURATION.plain, order: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer())).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});

describe('the payment-status projection', () => {
  const captured = (data: unknown): DomainEvent => ({
    name: 'payment.captured',
    id: 'payment.captured:1',
    source: 'payment',
    at: '2026-10-25T12:00:00.000Z',
    correlationId: 'o-1',
    data,
  });

  it('advances the order the capture names, claiming the event', async () => {
    const bus = makeRecordingEventBus();
    const paid: unknown[][] = [];
    const store = {
      markPaid: (...args: unknown[]) =>
        Effect.sync(() => {
          paid.push(args);
          return 'claimed' as const;
        }),
    } as unknown as ProductOrderStore;

    await Effect.runPromise(
      Effect.andThen(startPaymentStatusProjection, () =>
        // Lazily: the double picks its subscribers when `deliver` is called.
        bus.deliver(
          captured({
            paymentId: 'pay-1',
            orderId: 'o-1',
            amount: 40,
            currency: 'GTQ',
            paymentMethod: 'card',
            decidedAt: '2026-10-25T12:00:00.000Z',
          }),
        ),
      ).pipe(
        Effect.provideService(EventBusTag, bus),
        Effect.provideService(ProductOrderStoreTag, store),
      ),
    );

    expect(capturedSubscription).toMatchObject({
      slice: 'order',
      mode: 'work',
    });
    expect(paid).toEqual([
      [
        { consumer: expect.any(String), eventId: 'payment.captured:1' },
        'o-1',
        '2026-10-25T12:00:00.000Z',
      ],
    ]);
  });
});
