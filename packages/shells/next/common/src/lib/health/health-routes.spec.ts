import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHealthRoutes } from './health-routes';

const OPTIONS = {
  app: '@r10c/some-app',
  configApiUrl: 'http://localhost:3190',
  configKey: 'some-app',
};

const stubFetch = (impl: typeof fetch) => {
  vi.stubGlobal('fetch', vi.fn(impl));
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONFIG_SERVICE_TOKEN;
});

describe('createHealthRoutes', () => {
  it('keeps /api/health answering as it always did', async () => {
    const routes = createHealthRoutes(OPTIONS);

    const response = routes.health();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', app: OPTIONS.app });
  });

  // Liveness answers from the process alone — no config-service, no backend.
  // It is what Playwright's `webServer.url` waits on, so it must not depend on
  // anything that may not be running yet.
  it('answers liveness without touching config-service', async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error('unused')));
    const routes = createHealthRoutes(OPTIONS);

    const response = routes.live();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'live', app: OPTIONS.app });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports ready when config-service answers', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const routes = createHealthRoutes(OPTIONS);

    const response = await routes.ready();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      app: OPTIONS.app,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3190/api/config/some-app',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  // The lookup is token-gated, and a probe that omits the header reads a `401`
  // as "degraded" — an app that never becomes Ready while being perfectly
  // healthy. Regression guard for exactly that.
  it('presents the fleet service token', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );

    await createHealthRoutes(OPTIONS).ready();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3190/api/config/some-app',
      expect.objectContaining({
        headers: { 'x-service-token': 'dev-config-service-token-change-me' },
      }),
    );
  });

  it('prefers the configured token over the dev default', async () => {
    process.env.CONFIG_SERVICE_TOKEN = 'from-env';
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );

    await createHealthRoutes(OPTIONS).ready();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3190/api/config/some-app',
      expect.objectContaining({
        headers: { 'x-service-token': 'from-env' },
      }),
    );
  });

  it('reports degraded when config-service answers with an error', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: 500 })));
    const routes = createHealthRoutes(OPTIONS);

    const response = await routes.ready();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'degraded',
      app: OPTIONS.app,
      failing: ['config'],
    });
  });

  it('reports degraded when config-service is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const routes = createHealthRoutes(OPTIONS);

    const response = await routes.ready();

    expect(response.status).toBe(503);
  });

  it('serves a repeat readiness request from the cache', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const routes = createHealthRoutes(OPTIONS);

    await routes.ready();
    await routes.ready();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
