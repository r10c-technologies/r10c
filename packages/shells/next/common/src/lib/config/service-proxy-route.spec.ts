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

const answering = (
  body: string | null,
  status: number,
  headers?: Record<string, string>,
) =>
  vi.fn((..._args: Parameters<typeof fetch>) =>
    Promise.resolve(new Response(body, { status, headers })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.mockReturnValue('the-token');
});

describe('createServiceProxyRoute', () => {
  // The whole point: reading this body to completion holds the request open
  // forever and delivers nothing, with no error and no timeout (ADR 0036).
  it('pipes an event stream through instead of buffering it', async () => {
    const frames = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: a\ndata: {}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(frames, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await forward(
      new Request('http://app.test/api/admin/transaction/events'),
      params(['transaction', 'events']),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    // Scoped to one principal, so a cached copy is a cross-account delivery.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('id: a\ndata: {}\n\n');
  });

  it('still rebuilds a JSON body as JSON', async () => {
    const fetchMock = answering('{"ok":true}', 200, {
      'content-type': 'application/json',
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await forward(
      new Request('http://app.test/api/admin/product-specification'),
      params(['product-specification']),
    );

    expect(response.headers.get('content-type')).toBe('application/json');
  });

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

  /**
   * The caching contract, in both directions. Without it `$metadata` — which
   * computes and hashes a permission-filtered document per request — can never
   * answer `304`, because the validator never reaches the service.
   */
  describe('the caching contract', () => {
    it('forwards the validator upstream', async () => {
      const fetchMock = answering('{}', 200);
      vi.stubGlobal('fetch', fetchMock);

      await forward(
        new Request('http://app.test/api/marketplace/product-brand/$metadata', {
          headers: { 'if-none-match': '"abc"' },
        }),
        params(['product-brand', '$metadata']),
      );

      expect(
        (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)[
          'if-none-match'
        ],
      ).toBe('"abc"');
    });

    it('carries the validator and the cache directives back', async () => {
      vi.stubGlobal(
        'fetch',
        answering('{"actions":[]}', 200, {
          etag: '"abc"',
          'cache-control': 'private, no-cache',
          vary: 'Cookie, Authorization',
        }),
      );

      const response = await forward(
        new Request('http://app.test/api/marketplace/product-brand/$metadata'),
        params(['product-brand', '$metadata']),
      );

      expect(response.headers.get('etag')).toBe('"abc"');
      expect(response.headers.get('cache-control')).toBe('private, no-cache');
      // `Vary` is correctness, not tuning: the document differs per caller, and
      // one cached without it can be served to a different principal.
      expect(response.headers.get('vary')).toBe('Cookie, Authorization');
    });

    /** A `304` reconstructed with a body is no longer a `304`. */
    it('answers a 304 with no body', async () => {
      vi.stubGlobal('fetch', answering(null, 304, { etag: '"abc"' }));

      const response = await forward(
        new Request('http://app.test/api/marketplace/product-brand/$metadata', {
          headers: { 'if-none-match': '"abc"' },
        }),
        params(['product-brand', '$metadata']),
      );

      expect(response.status).toBe(304);
      expect(response.headers.get('etag')).toBe('"abc"');
      expect(await response.text()).toBe('');
    });

    /**
     * A short allow-list, not a copy of every header: the upstream's
     * `content-length` describes *its* body, and carrying it onto a rebuilt
     * response is how a proxy serves a truncated payload.
     */
    it('does not carry headers that describe the upstream body', async () => {
      vi.stubGlobal(
        'fetch',
        answering('{"a":1}', 200, { 'content-length': '9999' }),
      );

      const response = await forward(
        new Request('http://app.test/api/marketplace/product-brand'),
        params(['product-brand']),
      );

      expect(response.headers.get('content-length')).not.toBe('9999');
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
