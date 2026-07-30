import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConfigProxyRoute } from './config-proxy-route.js';

const CONFIG_URL = 'http://config.test';

const cookieValue = vi.fn<() => string | undefined>(() => 'the-token');

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieValue();
        return name === 'r10c_at' && value !== undefined
          ? { name, value }
          : undefined;
      },
    }),
}));

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

const forward = createConfigProxyRoute({ configApiUrl: CONFIG_URL });

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.mockReturnValue('the-token');
});

describe('createConfigProxyRoute', () => {
  it('forwards the path and query, carrying the cookie as a bearer token', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response('{"data":[]}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await forward(
      new Request('http://app.test/api/system/configuration?rsql=key==uri'),
      params(['configuration']),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CONFIG_URL}/api/configuration?rsql=key==uri`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer the-token',
        }),
      }),
    );
  });

  it('omits the authorization header when there is no session cookie', async () => {
    cookieValue.mockReturnValue(undefined);
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    // The proxy still forwards: it carries, it does not decide. config-service
    // answers the 401.
    const response = await forward(
      new Request('http://app.test/api/system/configuration'),
      params(['configuration']),
    );

    expect(response.status).toBe(401);
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({
      headers: { Authorization: expect.anything() },
    });
  });

  it('forwards a body on a write, and none on a GET or DELETE', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await forward(
      new Request('http://app.test/api/system/configuration', {
        method: 'PUT',
        body: '{"value":"x"}',
      }),
      params(['configuration']),
    );
    await forward(
      new Request('http://app.test/api/system/configuration/c-1', {
        method: 'DELETE',
      }),
      params(['configuration', 'c-1']),
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: '{"value":"x"}',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'DELETE',
      body: undefined,
    });
  });

  it('passes an empty body through as a status-only response', async () => {
    // `json()` on an empty body throws, which is why the handler checks first.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    const response = await forward(
      new Request('http://app.test/api/system/configuration/c-1', {
        method: 'DELETE',
      }),
      params(['configuration', 'c-1']),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('defaults to the local config-service when nothing is configured', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const previous = process.env.CONFIG_API_URL;
    delete process.env.CONFIG_API_URL;

    await createConfigProxyRoute()(
      new Request('http://app.test/api/system/configuration'),
      params(['configuration']),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3190/api/configuration',
    );
    if (previous !== undefined) process.env.CONFIG_API_URL = previous;
  });
});
