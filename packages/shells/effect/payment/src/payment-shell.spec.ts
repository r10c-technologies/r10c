import { generateKeyPairSync } from 'node:crypto';

import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAppLayer, paymentComposition, router } from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const configurationWith = (provider: Record<string, unknown>) =>
  fleetConfigurationOf({
    jwt: configurationRows({
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      keyId: 'spec-key',
    }),
    service: configurationRows({ token: 'spec-crossing-token' }),
    mongo: configurationRows({
      uri: 'mongodb://127.0.0.1:1/?directConnection=true',
      db: 'payment',
    }),
    rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
    amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
    outbox: configurationRows({ maxAttempts: 4 }),
    provider: configurationRows(provider),
  });

describe('the payment shell', () => {
  it.each([
    [
      'a decline reason of its own',
      { outcome: 'decline', declineReason: 'no' },
    ],
    ['a blank decline reason', { outcome: 'capture', declineReason: '' }],
  ])(
    'composes from its configuration with %s, without dialling anything',
    async (_label, provider) => {
      const layer = await Effect.runPromise(
        paymentComposition(configurationWith(provider)),
      );

      expect(Layer.isLayer(layer)).toBe(true);
    },
  );

  it('refuses a configuration that names no provider outcome, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      paymentComposition(configurationWith({})),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer())).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});
