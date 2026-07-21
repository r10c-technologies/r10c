import { ConfigurationStoreInMemory, EntifixConnError } from '@r10c/entifix-ts-core';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  loadRemoteConfigurationStore,
} from './load-remote-configuration.js';

const CONFIG_API = 'http://config-service:3190';
const SERVICE = 'marketplace-admin-service';

const plain = {
  mongo: [
    { key: 'uri', value: 'mongodb://host/db' },
    { key: 'db', value: 'catalog' },
  ],
};

const server = setupEntifixServer(
  http.get(`${CONFIG_API}/api/config/${SERVICE}`, () => HttpResponse.json(plain)),
);

const recordRequests = () => {
  const urls: string[] = [];
  server.events.on('request:start', ({ request }) => {
    urls.push(request.url);
  });
  return urls;
};

describe('loadRemoteConfiguration', () => {
  it('fetches the service’s own configuration document', async () => {
    expect(
      await Effect.runPromise(loadRemoteConfiguration(CONFIG_API, SERVICE)),
    ).toEqual(plain);
  });

  it('addresses config-service by service name', async () => {
    const urls = recordRequests();

    await Effect.runPromise(loadRemoteConfiguration(CONFIG_API, SERVICE));

    expect(urls).toContain(`${CONFIG_API}/api/config/${SERVICE}`);
  });

  // The base URL comes from an env var, so a trailing slash is entirely likely
  // and must not produce a `//api/config` path.
  it('tolerates a trailing slash on the base URL', async () => {
    const urls = recordRequests();

    await Effect.runPromise(loadRemoteConfiguration(`${CONFIG_API}///`, SERVICE));

    expect(urls).toContain(`${CONFIG_API}/api/config/${SERVICE}`);
  });

  it.each([
    ['an error status', () => new HttpResponse(null, { status: 500 })],
    ['a dropped connection', () => HttpResponse.error()],
    ['a non-JSON body', () => new HttpResponse('<html>nope</html>')],
  ])('fails with EntifixConnError on %s', async (_label, respond) => {
    server.use(http.get(`${CONFIG_API}/api/config/${SERVICE}`, respond));

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfiguration(CONFIG_API, SERVICE)),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
    expect(error.message).toContain(SERVICE);
    expect(error.details).toMatchObject({ service: SERVICE });
  });

  it('reports the status it got back', async () => {
    server.use(
      http.get(
        `${CONFIG_API}/api/config/${SERVICE}`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfiguration(CONFIG_API, SERVICE)),
    );

    expect(error.cause?.message).toContain('404');
  });
});

describe('loadRemoteConfigurationStore', () => {
  it('wraps the fetched configuration in a readable store', async () => {
    const store = await Effect.runPromise(
      loadRemoteConfigurationStore(CONFIG_API, SERVICE),
    );

    expect(store).toBeInstanceOf(ConfigurationStoreInMemory);
    expect(await Effect.runPromise(store.in('mongo').getString('uri'))).toBe(
      'mongodb://host/db',
    );
  });

  it('propagates the load failure rather than yielding an empty store', async () => {
    server.use(
      http.get(
        `${CONFIG_API}/api/config/${SERVICE}`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfigurationStore(CONFIG_API, SERVICE)),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('LoadedConfigurationTag', () => {
  // The raw document is kept in context so `GET /api/config` can expose it
  // (redacted) without re-fetching.
  it('carries the loaded document through the Effect context', () => {
    const context = Context.make(LoadedConfigurationTag, plain);

    expect(Context.get(context, LoadedConfigurationTag)).toBe(plain);
  });
});
