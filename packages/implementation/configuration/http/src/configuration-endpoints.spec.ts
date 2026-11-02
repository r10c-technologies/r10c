import type { EntityApiContext } from '@entifix/business';
import {
  Configuration,
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
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { configurationApi } from './configuration-api.js';
import {
  configurationLookupEndpoints,
  ConfigurationStoreLocationTag,
} from './lookup-endpoints.js';

const context: EntityApiContext = {
  principal: {
    userId: 'u-1',
    subject: 'ada@example.com',
    sessionId: 's-1',
    roles: ['admin'],
  } as never,
  links: {
    record: id => [{ rel: 'self', href: `/api/configuration/${String(id)}` }],
    collection: () => [{ rel: 'collection', href: '/api/configuration' }],
  },
};

const envelope = (data: Record<string, unknown>) => ({
  meta: { type: 'entity', entity: 'configuration' },
  data,
});

const overrides = configurationApi.options.override;

const withWriter = <A, E>(
  effect: Effect.Effect<A, E, ConfigurationWriterTag>,
) =>
  Effect.provideService(
    effect,
    ConfigurationWriterTag,
    makeInMemoryConfigurationWriter(CONTRACT_SECRET),
  );
const run = <A, E>(effect: Effect.Effect<A, E, ConfigurationWriterTag>) =>
  Effect.runPromise(withWriter(effect));
const refusal = <A, E>(effect: Effect.Effect<A, E, ConfigurationWriterTag>) =>
  Effect.runPromise(Effect.flip(withWriter(effect)));

describe('the configuration declaration', () => {
  it('serves every verb behind the derived permission', () => {
    expect(configurationApi.key).toBe('configuration');
    expect(configurationApi.entity).toBe(Configuration);
    expect(configurationApi.options.guard).toEqual({ kind: 'permission' });
  });

  it('creates through the audited writer, stamped with the actor', async () => {
    const result = await run(
      overrides.create.handler(
        {
          payload: envelope({
            service: 'order-service',
            groupName: 'order',
            key: 'limit',
            value: '3',
          }),
        },
        context,
      ),
    );

    expect(result).toMatchObject({
      data: { key: 'limit', value: '3', updated_by: 'ada@example.com' },
      meta: { links: [{ rel: 'self' }] },
    });
  });

  it('updates the row the path names, whatever the payload says', async () => {
    const result = await run(
      overrides.update.handler(
        {
          params: { id: CONTRACT_SECRET.id },
          payload: envelope({ id: 'elsewhere', is_secret: true, value: '' }),
        },
        context,
      ),
    );

    expect(result).toMatchObject({ data: { id: CONTRACT_SECRET.id } });
  });

  it('refuses clearing a secret without a new value, as the typed failure', async () => {
    const failure = await refusal(
      overrides.update.handler(
        {
          params: { id: CONTRACT_SECRET.id },
          payload: envelope({ is_secret: false, value: '' }),
        },
        context,
      ),
    );

    expect(failure).toMatchObject({
      code: 'secretRequiresValue',
      category: 'invalid',
    });
  });

  it('deletes a row and answers its collection link, or notFound', async () => {
    const deleted = await run(
      overrides.delete.handler({ params: { id: CONTRACT_SECRET.id } }, context),
    );
    const missing = await refusal(
      overrides.delete.handler({ params: { id: 'nobody' } }, context),
    );

    expect(deleted).toMatchObject({
      meta: { entity: 'configuration', links: [{ rel: 'collection' }] },
      data: { id: CONTRACT_SECRET.id },
    });
    expect(missing).toMatchObject({ _tag: 'NotFound', code: 'notFound' });
  });
});

describe('the lookup endpoints', () => {
  const [introspection, lookup] = configurationLookupEndpoints;
  const lookupLayer = makeInMemoryConfigurationLookup(CONTRACT_ROWS);

  it('are behind the fleet token', () => {
    expect(
      configurationLookupEndpoints.map(endpoint => [
        `${endpoint.descriptor.method} ${endpoint.descriptor.path}`,
        endpoint.descriptor.guard.kind,
      ]),
    ).toEqual([
      ['GET /api/config', 'fleet'],
      ['GET /api/config/:service', 'fleet'],
    ]);
  });

  it('describe the store by its redacted location and its rows', async () => {
    const answer = await Effect.runPromise(
      introspection
        .handler({} as never)
        .pipe(
          Effect.provideService(ConfigurationLookupTag, lookupLayer),
          Effect.provideService(
            ConfigurationStoreLocationTag,
            'postgres://***@db/config',
          ),
        ),
    );

    expect(answer).toMatchObject({
      service: '@r10c/config-service',
      store: 'postgres',
      pgUrl: 'postgres://***@db/config',
      rowCount: CONTRACT_ROWS.length,
    });
  });

  it('answer one service its real values', async () => {
    const answer = await Effect.runPromise(
      lookup
        .handler({ params: { service: CONTRACT_SERVICE } })
        .pipe(Effect.provideService(ConfigurationLookupTag, lookupLayer)),
    );

    expect(Object.keys(answer as object).length).toBeGreaterThan(0);
  });
});
