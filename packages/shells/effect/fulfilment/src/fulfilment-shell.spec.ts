import { generateKeyPairSync } from 'node:crypto';

import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  endpoints,
  FULFILMENT_SLICE,
  fulfilmentComposition,
  makeAppLayer,
  policy,
} from './index.js';

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
  tenant: configurationRows({ dbPrefix: 'fulfilment_' }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  outbox: configurationRows({ maxAttempts: 4 }),
  idempotency: configurationRows({ retentionMs: 60_000 }),
});

describe('the fulfilment shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(fulfilmentComposition(CONFIGURATION));

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no tenant prefix, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      fulfilmentComposition(
        fleetConfigurationOf({ ...CONFIGURATION.plain, tenant: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition, its endpoints and its policy', () => {
    expect(Layer.isLayer(makeAppLayer())).toBe(true);
    expect(endpoints).toHaveLength(3);
    expect(policy).toBeDefined();
    expect(FULFILMENT_SLICE).toBe('fulfilment');
  });
});
