import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServiceProxyRoute } from './service-proxy-route';

const SERVICE_URL = 'http://marketplace-service.test';

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

const forward = createServiceProxyRoute({ baseUrl: SERVICE_URL });

const answering = (body: string | null, status: number) =>
  vi.fn((..._args: Parameters<typeof fetch>) =>
    Promise.resolve(new Response(body, { status })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.mockReturnValue('the-token');
});

describe('createServiceProxyRoute', () => {
  it('forwards the path and query, carrying the cookie as a bearer token', async () => {
    const fetchMock = answering('{"data":[]}', 200);
    vi.stubGlobal('fetch', fetchMock);

    const response = await forward(
      new Request('http://app.test/api/marketplace/product-brand?sort=name'),
      params(['product-brand']),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVICE_URL}/api/product-brand?sort=name`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer the-token',
        }),
      }),
    );
  });

  it('joins a nested path', async () => {
    const fetchMock = answering('{}', 200);
    vi.stubGlobal('fetch', fetchMock);

    await forward(
      new Request('http://app.test/api/marketplace/product-brand/b-1'),
      params(['product-brand', 'b-1']),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVICE_URL}/api/product-brand/b-1`,
      expect.anything(),
    );
  });

  // marketplace-service serves reads to anonymous storefront traffic, so an
  // absent cookie must not become an empty bearer token the service then
  // rejects.
  it('omits the authorization header when there is no session cookie', async () => {
    cookieValue.mockReturnValue(undefined);
    const fetchMock = answering('{}', 200);
    vi.stubGlobal('fetch', fetchMock);

    const response = await forward(
      new Request('http://app.test/api/marketplace/product-brand'),
      params(['product-brand']),
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[1]).not.toMatchObject({
      headers: { Authorization: expect.anything() },
    });
  });

  // The proxy carries, it does not decide: the service still applies its own
  // `requirePermission` and this handler passes the refusal straight back.
  it('passes a refusal through untouched', async () => {
    vi.stubGlobal('fetch', answering('{"error":"forbidden"}', 403));

    const response = await forward(
      new Request('http://app.test/api/marketplace/product-brand', {
        method: 'POST',
        body: '{}',
      }),
      params(['product-brand']),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('forwards a body on a write, and none on a GET or DELETE', async () => {
    const fetchMock = answering('{}', 200);
    vi.stubGlobal('fetch', fetchMock);

    await forward(
      new Request('http://app.test/api/marketplace/product-brand/b-1', {
        method: 'PUT',
        body: '{"name":"Acme"}',
      }),
      params(['product-brand', 'b-1']),
    );
    await forward(
      new Request('http://app.test/api/marketplace/product-brand/b-1', {
        method: 'DELETE',
      }),
      params(['product-brand', 'b-1']),
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: '{"name":"Acme"}',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'DELETE',
      body: undefined,
    });
  });

  it('passes an empty body through as a status-only response', async () => {
    // `json()` on an empty body throws, which is why the handler checks first.
    vi.stubGlobal('fetch', answering(null, 204));

    const response = await forward(
      new Request('http://app.test/api/marketplace/product-brand/b-1', {
        method: 'DELETE',
      }),
      params(['product-brand', 'b-1']),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
