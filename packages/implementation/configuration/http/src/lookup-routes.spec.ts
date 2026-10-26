import { EntifixConnError } from '@entifix/core';
import { ConfigurationLookupTag } from '@r10c/business-ts-configuration';
import {
  CONTRACT_ROWS,
  makeInMemoryConfigurationLookup,
} from '@r10c/business-ts-configuration/testing';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { DEV_SERVICE_TOKEN, SERVICE_TOKEN_HEADER } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import {
  configurationLookupRoutes,
  ConfigurationStoreLocationTag,
} from './lookup-routes.js';

const LOCATION = 'postgres://postgres:hunter2@db:5432/postgres';

const served: ServedRoutes[] = [];
const serve = (lookup = makeInMemoryConfigurationLookup(CONTRACT_ROWS)) => {
  const one = serveRoutes(
    configurationLookupRoutes,
    Layer.mergeAll(
      Layer.succeed(ConfigurationLookupTag, lookup),
      Layer.succeed(ConfigurationStoreLocationTag, LOCATION),
    ),
  );
  served.push(one);
  return one;
};

afterAll(async () => {
  await Promise.all(served.map(one => one.dispose()));
});

const asFleet = { headers: { [SERVICE_TOKEN_HEADER]: DEV_SERVICE_TOKEN } };

describe('GET /api/config/:service', () => {
  it('serves a booting service its rows with real values, behind the fleet token', async () => {
    const routes = serve();

    const response = await routes.call('/api/config/payment-service', asFleet);
    const anonymous = await routes.call('/api/config/payment-service');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mongo: [{ key: 'uri', value: 'mongodb://user:secret@host' }, {}],
    });
    expect(anonymous.status).toBe(401);
  });
});

describe('GET /api/config', () => {
  it('describes the store with its location redacted', async () => {
    const response = await serve().call('/api/config', asFleet);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      service: '@r10c/config-service',
      store: 'postgres',
      rowCount: 3,
      services: ['order-service', 'payment-service'],
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});

describe('a store that fails', () => {
  it('answers both routes 500 configUnavailable', async () => {
    const down = Effect.fail(new EntifixConnError('store down'));
    const routes = serve({ forService: () => down, stats: () => down });

    const responses = await Promise.all(
      ['/api/config', '/api/config/payment-service'].map(path =>
        routes.call(path, asFleet),
      ),
    );

    expect(responses.map(response => response.status)).toEqual([500, 500]);
    expect(await responses[0]?.json()).toMatchObject({
      code: 'configUnavailable',
    });
  });
});
