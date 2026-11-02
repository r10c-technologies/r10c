import { generateKeyPairSync } from 'node:crypto';

import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  InvalidToken,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { serveTestService } from '@entifix/service-shell/testing';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import {
  ConfigurationLookupTag,
  ConfigurationWriterTag,
} from '@r10c/business-ts-configuration';
import {
  CONTRACT_ROWS,
  CONTRACT_SECRET,
  CONTRACT_SERVICE,
  makeInMemoryConfigurationLookup,
  makeInMemoryConfigurationWriter,
} from '@r10c/business-ts-configuration/testing';
import { ConfigurationStoreLocationTag } from '@r10c/implementation-configuration-http';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import { authLayer, migrateAndSeed } from './app-layer.js';
import { endpoints, makeAppLayer, policy } from './index.js';

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

  it('migrates an empty seed and inserts nothing', async () => {
    const fake = makeFakeSqlClient();

    await Effect.runPromise(
      migrateAndSeed([]).pipe(
        Effect.provideService(SqlClient.SqlClient, fake.client as never),
      ),
    );

    const statements = fake.executions.map(execution => execution.sql);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS configuration');
    expect(statements.some(sql => sql.includes('INSERT INTO'))).toBe(false);
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
  it('offers the composition as a layer', () => {
    expect(Layer.isLayer(makeAppLayer({ seedRows: [] }))).toBe(true);
  });
});

const operator: TokenClaims = {
  userId: 'u-1',
  subject: 'ops@example.com',
  sessionId: 's-1',
  roles: ['admin'],
};

/** The slice's endpoints over in-memory ports, served as config-service serves them. */
const serveConfig = () =>
  serveTestService({
    name: '@r10c/config-service',
    port: 0,
    slices: ['config'],
    description: fleetToken,
    endpoints,
    policy,
    appLayer: Layer.mergeAll(
      Layer.succeed(
        ConfigurationWriterTag,
        makeInMemoryConfigurationWriter(CONTRACT_SECRET),
      ),
      Layer.succeed(
        ConfigurationLookupTag,
        makeInMemoryConfigurationLookup(CONTRACT_ROWS),
      ),
      Layer.succeed(ConfigurationStoreLocationTag, 'postgres://***@db/config'),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('token'),
        verify: token =>
          token === 'good'
            ? Effect.succeed(operator)
            : Effect.fail(new InvalidToken()),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({
          admin: ['config:configuration:write', 'config:configuration:delete'],
        }),
      ),
      // The generic reads are not exercised here; the writes are the cell's.
      Layer.succeed(EntityRepositoryFactoryTag, {} as never),
    ),
  });

const asOperator = { authorization: 'Bearer good' };

describe('the config endpoints', () => {
  it('answer a refused write, a missing row and a missing token as problems', async () => {
    const service = await serveConfig();
    try {
      const refused = await fetch(
        `${service.baseUrl}/api/configuration/${CONTRACT_SECRET.id}`,
        {
          method: 'PUT',
          headers: { ...asOperator, 'content-type': 'application/json' },
          body: JSON.stringify({
            meta: { type: 'entity', entity: 'configuration' },
            data: { is_secret: false, value: '' },
          }),
        },
      );
      const missing = await fetch(
        `${service.baseUrl}/api/configuration/nobody`,
        { method: 'DELETE', headers: asOperator },
      );
      const tokenless = await fetch(
        `${service.baseUrl}/api/config/${CONTRACT_SERVICE}`,
        { headers: { [fleetToken.header]: '' } },
      );
      const served = await fetch(
        `${service.baseUrl}/api/config/${CONTRACT_SERVICE}`,
        { headers: { [fleetToken.header]: fleetToken.token() } },
      );

      for (const response of [refused, missing, tokenless])
        expect(response.headers.get('content-type')).toContain(
          'application/problem+json',
        );
      expect([refused.status, missing.status, tokenless.status]).toEqual([
        400, 404, 401,
      ]);
      expect(await refused.json()).toMatchObject({
        code: 'secretRequiresValue',
      });
      expect(served.status).toBe(200);
    } finally {
      await service.close();
    }
  });
});
