import { EntifixBuildError } from '@r10c/entifix-ts-core';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ConfigurationStoreRestClient,
  type ConfigurationStoreRestClientOptions,
} from './configuration-store-rest-client.js';

const CONFIG_URL = 'http://service/api/config';

const plain = {
  restUri: [{ key: 'service-domain', value: 'http://service/api' }],
  mongo: [{ key: 'uri', value: 'mongodb://host' }],
};

const server = setupEntifixServer(http.get(CONFIG_URL, () => HttpResponse.json(plain)));

const store = (options: ConfigurationStoreRestClientOptions = { url: CONFIG_URL }) =>
  new ConfigurationStoreRestClient(options);

const countRequests = () => {
  let count = 0;
  server.events.on('request:start', () => {
    count += 1;
  });
  return () => count;
};

describe('ConfigurationStoreRestClient', () => {
  it('resolves a key from the fetched configuration', async () => {
    expect(
      await Effect.runPromise(store().in('mongo').getString('uri')),
    ).toBe('mongodb://host');
  });

  it('scopes each group view to its own entries', async () => {
    const client = store();

    expect(
      await Effect.runPromise(client.in('restUri').getString('service-domain')),
    ).toBe('http://service/api');
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(client.in('restUri').getString('uri')),
      ),
    ).toBe(true);
  });

  // Delegating to core's in-memory store is what keeps the parsing rules —
  // including `compose` — identical on both sides of the transport.
  it('supports the compose extract mode', async () => {
    expect(
      await Effect.runPromise(
        store().in('restUri').getString('service-domain.product.brand', 'compose'),
      ),
    ).toBe('http://service/api/product/brand');
  });

  // The configuration is fetched at most once per client: every adapter call
  // goes through `in(...)`, so an unmemoized store would re-request per read.
  it('fetches the configuration only once per client', async () => {
    const requests = countRequests();
    const client = store();

    await Effect.runPromise(client.in('mongo').getString('uri'));
    await Effect.runPromise(client.in('mongo').getString('uri'));
    await Effect.runPromise(client.in('restUri').getString('service-domain'));

    expect(requests()).toBe(1);
  });

  // The default is the *same-origin* `/api/config` route, which only resolves
  // in a browser; under Node it has no origin to resolve against, so what the
  // default can be asserted on here is the URL it reports having tried.
  it('defaults to the same-origin /api/config route', async () => {
    const error = await Effect.runPromise(
      Effect.flip(new ConfigurationStoreRestClient().in('mongo').getString('uri')),
    );

    expect(error.details).toEqual({ url: '/api/config' });
  });

  it('fails with an EntifixBuildError when the endpoint answers an error status', async () => {
    server.use(http.get(CONFIG_URL, () => new HttpResponse(null, { status: 503 })));

    const error = await Effect.runPromise(
      Effect.flip(store().in('mongo').getString('uri')),
    );

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.message).toContain('Failed to load configuration');
    expect(error.cause?.message).toContain('status 503');
  });

  it('fails when the endpoint is unreachable', async () => {
    server.use(http.get(CONFIG_URL, () => HttpResponse.error()));

    const error = await Effect.runPromise(
      Effect.flip(store().in('mongo').getString('uri')),
    );

    expect(error).toBeInstanceOf(EntifixBuildError);
  });

  it('fails on a key the configuration does not carry', async () => {
    const error = await Effect.runPromise(
      Effect.flip(store().in('mongo').getString('absent')),
    );

    expect(error.message).toContain('not found');
  });

  // Only `getString` is implemented so far. The rest defect rather than
  // returning a wrong value — a silent `undefined` would be far worse than a
  // loud "not implemented" at the composition root.
  describe('the unimplemented getters', () => {
    const notImplemented = [
      'getNumber',
      'getDate',
      'getArrayNumber',
      'getArrayString',
      'getArrayDate',
      'getOptionalNumber',
      'getOptionalString',
      'getOptionalDate',
      'getOptionalArrayNumber',
      'getOptionalArrayString',
      'getOptionalArrayDate',
    ] as const;

    it.each(notImplemented)('%s defects', async (name) => {
      // Erased to one signature: the getters differ only in their success type,
      // and none of them produces one.
      const group = store().in('mongo') as unknown as Record<
        string,
        (key: string) => Effect.Effect<unknown, EntifixBuildError>
      >;

      const exit = await Effect.runPromiseExit(group[name]('uri'));

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
