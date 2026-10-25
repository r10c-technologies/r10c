import { generateKeyPairSync } from 'node:crypto';

import { PolicyDecisionTag, ServiceCrossingPolicyTag } from '@entifix/authz';
import {
  ConfigurationRepositoryTag,
  HealthRegistryLayer,
  TenantDatabaseResolverTag,
  TenantDirectoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import { OutboxMaxAttempts } from '@entifix/mongo/transactions';
import { ServiceCrossingTokenTag } from '@entifix/service-shell';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import { EventSourceTag } from '@entifix/transactions';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { fleetBusLayer, fleetOutboxLayer } from './fleet-bus.js';
import {
  crossingTokenLayer,
  fleetPolicyLayer,
  fleetSecurityLayer,
} from './fleet-security.js';
import type { FleetConfiguration } from './fleet-service.js';
import {
  fleetMongoPoolLayer,
  fleetSingleMongoLayer,
  fleetTenancyLayer,
  fleetTenantMongoLayer,
} from './fleet-storage.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const configurationOf = (plain: ConfigurationPlain): FleetConfiguration => ({
  plain,
  store: new ConfigurationClientInMemory(plain),
});

const rows = (group: Record<string, unknown>) =>
  Object.entries(group).map(([key, value]) => ({ key, value }));

const FLEET = configurationOf({
  jwt: rows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  service: rows({ token: 'spec-crossing-token' }),
  mongo: rows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
    db: 'spec',
  }),
  tenant: rows({ dbPrefix: 'spec_' }),
  rabbitmq: rows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: rows({ uri: 'amqp://127.0.0.1:2' }),
  outbox: rows({ maxAttempts: 4 }),
});

describe('fleetSecurityLayer', () => {
  it('provides a verifier, the grant table, the crossing policy and the configuration', async () => {
    const provided = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* fleetSecurityLayer(FLEET);
        return yield* Effect.gen(function* () {
          const tokens = yield* TokenServiceTag;
          const policy = yield* PolicyDecisionTag;
          const crossing = yield* ServiceCrossingPolicyTag;
          const loaded = yield* LoadedConfigurationTag;
          yield* ConfigurationRepositoryTag;
          return { tokens, policy, crossing, loaded };
        }).pipe(Effect.provide(layer));
      }),
    );

    expect(typeof provided.tokens.verify).toBe('function');
    expect(
      provided.policy.decide({
        subject: { roles: ['super-admin'] },
        resource: 'catalog:widget',
        action: 'read',
      }),
    ).toBe(true);
    expect(typeof provided.crossing.allows).toBe('function');
    expect(provided.loaded).toBe(FLEET.plain);
  });

  it('refuses a configuration with no verification key', async () => {
    const exit = await Effect.runPromiseExit(
      fleetSecurityLayer(configurationOf({} as ConfigurationPlain)),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the policies alone, for a service that brings its own token service', () => {
    expect(Layer.isLayer(fleetPolicyLayer(FLEET))).toBe(true);
  });
});

describe('crossingTokenLayer', () => {
  it('provides the token this service accepts, from its own row', async () => {
    const token = await Effect.runPromise(
      Effect.flatMap(crossingTokenLayer(FLEET), layer =>
        Effect.provide(
          Effect.gen(function* () {
            return yield* ServiceCrossingTokenTag;
          }),
          layer,
        ),
      ),
    );

    expect(token).toBe('spec-crossing-token');
  });
});

describe('the fleet Mongo layers', () => {
  it('builds a single store from `mongo.db`, a per-organization one from `tenant.dbPrefix`, and a bare pool', async () => {
    const single = await Effect.runPromise(
      fleetSingleMongoLayer(FLEET, ['spec']),
    );
    const tenants = await Effect.runPromise(
      fleetTenantMongoLayer(FLEET, ['spec']),
    );

    const pool = await Effect.runPromise(fleetMongoPoolLayer(FLEET, ['spec']));

    expect(Layer.isLayer(single)).toBe(true);
    expect(Layer.isLayer(tenants)).toBe(true);
    expect(Layer.isLayer(pool)).toBe(true);
  });

  it('refuses a per-organization store with no prefix rather than defaulting one', async () => {
    const exit = await Effect.runPromiseExit(
      fleetTenantMongoLayer(
        configurationOf({ mongo: rows({ uri: 'mongodb://x' }) }),
        ['spec'],
      ),
    );

    expect(exit._tag).toBe('Failure');
  });
});

describe('fleetTenancyLayer', () => {
  it('resolves and lists organizations under the one prefix it was built with', async () => {
    const client = {
      db: (name: string) => ({
        databaseName: name,
        admin: () => ({
          listDatabases: () =>
            Promise.resolve({
              databases: [{ name: 'spec_org-1' }, { name: 'other_org-2' }],
            }),
        }),
      }),
    };

    const [resolved, listed] = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* TenantDatabaseResolverTag;
        const directory = yield* TenantDirectoryTag;
        return [
          (yield* resolver.forOrganization('org-1')) as {
            databaseName: string;
          },
          yield* directory.list(),
        ] as const;
      }).pipe(
        Effect.provide(
          fleetTenancyLayer('spec_', ['spec']).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(MongoClientTag, client as never),
                HealthRegistryLayer,
              ),
            ),
          ),
        ),
      ),
    );

    expect(resolved.databaseName).toBe('spec_org-1');
    expect(listed.map(tenant => tenant.organizationId)).toEqual(['org-1']);
  });
});

describe('fleetBusLayer', () => {
  it('reads the broker from `rabbitmq` by default, or from the group named', async () => {
    const byDefault = await Effect.runPromise(fleetBusLayer(FLEET));
    const named = await Effect.runPromise(fleetBusLayer(FLEET, 'amqp'));

    expect(Layer.isLayer(byDefault)).toBe(true);
    expect(Layer.isLayer(named)).toBe(true);
  });
});

describe('fleetOutboxLayer', () => {
  it('provides the slice the outbox publishes as and its attempt ceiling', async () => {
    const provided = await Effect.runPromise(
      Effect.flatMap(fleetOutboxLayer(FLEET, 'spec-slice'), layer =>
        Effect.provide(
          Effect.gen(function* () {
            return [yield* EventSourceTag, yield* OutboxMaxAttempts];
          }),
          layer,
        ),
      ),
    );

    expect(provided).toEqual(['spec-slice', 4]);
  });
});
