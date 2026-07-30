import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConfigRoute, rewriteServiceDomains } from './config-route';

const CONFIG_URL = 'http://config.test';

const okConfig = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONFIG_SERVICE_TOKEN;
});

describe('rewriteServiceDomains', () => {
  it('swaps a mapped domain for its proxy path', () => {
    const result = rewriteServiceDomains(
      {
        uri: [
          { key: 'admin-service-domain', value: 'http://localhost:3101/api' },
        ],
      },
      { 'admin-service-domain': '/api/admin' },
    );

    expect(result['uri']).toEqual([
      { key: 'admin-service-domain', value: '/api/admin' },
    ]);
  });

  it('rewrites several domains independently', () => {
    const result = rewriteServiceDomains(
      {
        uri: [
          { key: 'admin-service-domain', value: 'http://localhost:3101/api' },
          { key: 'config-service-domain', value: 'http://localhost:3190/api' },
        ],
      },
      {
        'admin-service-domain': '/api/admin',
        'config-service-domain': '/api/system',
      },
    );

    expect(result['uri']?.map(p => p.value)).toEqual([
      '/api/admin',
      '/api/system',
    ]);
  });

  it('passes through a key the app does not proxy', () => {
    const result = rewriteServiceDomains(
      { uri: [{ key: 'auth-service-domain', value: 'http://auth/api' }] },
      { 'config-service-domain': '/api/system' },
    );

    expect(result['uri']).toEqual([
      { key: 'auth-service-domain', value: 'http://auth/api' },
    ]);
  });

  it('keeps every other group untouched and tolerates a missing uri group', () => {
    const result = rewriteServiceDomains(
      { locale: [{ key: 'default', value: 'es' }] },
      { 'config-service-domain': '/api/system' },
    );

    expect(result['locale']).toEqual([{ key: 'default', value: 'es' }]);
    expect(result['uri']).toEqual([]);
  });
});

describe('createConfigRoute', () => {
  it('fetches this app configuration and rewrites the proxied domains', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(
        okConfig({
          uri: [
            { key: 'config-service-domain', value: 'http://localhost:3190/api' },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await createConfigRoute({
      service: 'marketplace-admin-app',
      proxies: { 'config-service-domain': '/api/system' },
      configApiUrl: CONFIG_URL,
    })();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uri: [{ key: 'config-service-domain', value: '/api/system' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CONFIG_URL}/api/config/marketplace-admin-app`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('presents the shared service token, since the lookup is gated', async () => {
    process.env.CONFIG_SERVICE_TOKEN = 'from-env';
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(okConfig({})),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createConfigRoute({ service: 'auth-app', configApiUrl: CONFIG_URL })();

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'x-service-token': 'from-env' },
    });
  });

  it('rewrites nothing when the app declares no proxies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          okConfig({ uri: [{ key: 'auth-service-domain', value: 'http://a' }] }),
        ),
      ),
    );

    const response = await createConfigRoute({
      service: 'auth-app',
      configApiUrl: CONFIG_URL,
    })();

    expect(await response.json()).toEqual({
      uri: [{ key: 'auth-service-domain', value: 'http://a' }],
    });
  });

  it('502s when config-service is unreachable or answers an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    );

    const response = await createConfigRoute({
      service: 'auth-app',
      configApiUrl: CONFIG_URL,
    })();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Failed to load configuration',
    });
  });

  it('defaults to the local config-service when nothing is configured', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(okConfig({})),
    );
    vi.stubGlobal('fetch', fetchMock);
    const previous = process.env.CONFIG_API_URL;
    delete process.env.CONFIG_API_URL;

    await createConfigRoute({ service: 'auth-app' })();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3190/api/config/auth-app',
    );
    if (previous !== undefined) process.env.CONFIG_API_URL = previous;
  });

  it('falls back to CONFIG_API_URL when no url is passed', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(okConfig({})),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.env.CONFIG_API_URL = 'http://from-env.test';

    await createConfigRoute({ service: 'auth-app' })();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://from-env.test/api/config/auth-app',
    );
    delete process.env.CONFIG_API_URL;
  });
});
