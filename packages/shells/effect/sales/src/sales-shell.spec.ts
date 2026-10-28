import { generateKeyPairSync } from 'node:crypto';

import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAppLayer, router, salesComposition } from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
  }),
  tenant: configurationRows({
    dbPrefix: 'sales_',
    demoOrganizationId: 'demo',
  }),
  transaction: configurationRows({
    url: 'http://coordinator.invalid/api',
    crossingToken: 'spec-coordinator-token',
  }),
  marketplace: configurationRows({ url: 'http://catalog.invalid/api' }),
});

const seed = () => Effect.void;

describe('the sales shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      salesComposition({ seed })(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no coordinator, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      salesComposition({ seed })(
        fleetConfigurationOf({ ...CONFIGURATION.plain, transaction: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer({ seed }))).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});
