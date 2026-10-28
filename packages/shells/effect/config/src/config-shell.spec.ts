import { generateKeyPairSync } from 'node:crypto';

import { TokenServiceTag } from '@entifix/business';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { ConfigurationLookupTag } from '@r10c/business-ts-configuration';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import { authLayer, migrateAndSeed } from './app-layer.js';
import { makeAppLayer, router } from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_KEY_PEM = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();

describe('the configuration store migration', () => {
  it('creates the tables, then seeds every row without overwriting one', async () => {
    const fake = makeFakeSqlClient();

    await Effect.runPromise(
      migrateAndSeed([
        {
          service: 'order-service',
          group_name: 'order',
          key: 'cancelWindowSeconds',
          value: '1800',
        },
        {
          service: 'order-service',
          group_name: 'service',
          key: 'token',
          value: 'secret',
          is_secret: true,
        },
      ]).pipe(Effect.provideService(SqlClient.SqlClient, fake.client as never)),
    );

    const statements = fake.executions.map(execution => execution.sql);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS configuration');
    const seed = fake.executions.at(-1);
    expect(seed?.sql).toContain(
      'ON CONFLICT (service, group_name, key) DO NOTHING',
    );
    expect(seed?.params).toContain('cancelWindowSeconds');
    expect(seed?.params).toContain(true);
    expect(seed?.params).toContain(false);
  });
});

describe('the token verification config-service reads from its own rows', () => {
  const lookupOf = (jwt?: Array<{ key: string; value: string }>) =>
    Layer.succeed(ConfigurationLookupTag, {
      forService: () =>
        Effect.succeed({
          ...(jwt === undefined ? {} : { jwt }),
          // A console sink, so building the observability opens nothing.
          logging: [
            { key: 'level', value: 'info' },
            { key: 'sink', value: 'console' },
          ],
        }),
    } as never);

  it('verifies with the public key its rows name', async () => {
    const verifier = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* TokenServiceTag;
      }).pipe(
        Effect.provide(
          authLayer.pipe(
            Layer.provide(
              lookupOf([
                { key: 'publicKey', value: PUBLIC_KEY_PEM },
                { key: 'keyId', value: 'spec-key' },
              ]),
            ),
          ),
        ),
      ),
    );

    expect(typeof verifier.verify).toBe('function');
  });

  it('refuses to start with no key rows at all', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* TokenServiceTag;
      }).pipe(Effect.provide(authLayer.pipe(Layer.provide(lookupOf())))),
    );

    expect(exit._tag).toBe('Failure');
  });
});

describe('the config shell', () => {
  it('offers the composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer({ seedRows: [] }))).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});
