import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AT_COOKIE, SID_COOKIE } from './cookies';
import { createRefreshRoute } from './refresh-route';

const AUTH_URL = 'http://auth.test';

/** The slice of `NextRequest` the handler actually reads. */
const requestWith = (sessionId?: string): NextRequest =>
  ({
    cookies: {
      get: (name: string) =>
        name === SID_COOKIE && sessionId !== undefined
          ? { name, value: sessionId }
          : undefined,
    },
  }) as unknown as NextRequest;

const okRefresh = () =>
  new Response(
    JSON.stringify({
      accessToken: 'fresh',
      expiresIn: 900,
      sessionExpiresIn: 604_800,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRefreshRoute', () => {
  it('401s without a session cookie', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await createRefreshRoute({ authServiceUrl: AUTH_URL })(
      requestWith(),
    );

    expect(response.status).toBe(401);
    // Nothing to refresh means nothing to ask auth-service about.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rewrites the access cookie from a successful refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRefresh()));

    const response = await createRefreshRoute({ authServiceUrl: AUTH_URL })(
      requestWith('sid-1'),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(AT_COOKIE)?.value).toBe('fresh');
    expect(await response.json()).toMatchObject({
      ok: true,
      sessionExpiresIn: 604_800,
    });
  });

  it('collapses concurrent refreshes into one upstream call', async () => {
    // Two tabs noticing the same expiring token in the same tick must not
    // produce two round trips.
    const fetchMock = vi.fn().mockResolvedValue(okRefresh());
    vi.stubGlobal('fetch', fetchMock);
    const handler = createRefreshRoute({ authServiceUrl: AUTH_URL });

    const [first, second] = await Promise.all([
      handler(requestWith('sid-shared')),
      handler(requestWith('sid-shared')),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Both callers still get a usable body — the shared Response is cloned.
    expect(first.cookies.get(AT_COOKIE)?.value).toBe('fresh');
    expect(second.cookies.get(AT_COOKIE)?.value).toBe('fresh');
  });

  it('clears the cookies when the session is gone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'session expired',
            code: 'sessionExpired',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const response = await createRefreshRoute({ authServiceUrl: AUTH_URL })(
      requestWith('sid-dead'),
    );

    expect(response.status).toBe(401);
    // Leaving them would keep the middleware protecting a session that can
    // never be renewed again.
    expect(response.cookies.get(AT_COOKIE)?.value).toBe('');
    expect(response.cookies.get(SID_COOKIE)?.value).toBe('');
  });

  it('keeps the cookies when auth-service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    const response = await createRefreshRoute({ authServiceUrl: AUTH_URL })(
      requestWith('sid-2'),
    );

    // A network blip is not evidence the session died, so signing the user out
    // here would be the wrong call.
    expect(response.status).toBe(503);
    expect(response.cookies.get(AT_COOKIE)).toBeUndefined();
    expect(await response.json()).toMatchObject({ code: 'network' });
  });

  it('falls back to AUTH_SERVICE_URL when no url is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRefresh());
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('AUTH_SERVICE_URL', 'http://from-env.test');

    await createRefreshRoute()(requestWith('sid-3'));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://from-env.test/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllEnvs();
  });

  it('falls back to the local port when the env is unset too', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRefresh());
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('AUTH_SERVICE_URL', undefined);

    await createRefreshRoute()(requestWith('sid-4'));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3102/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllEnvs();
  });
});
