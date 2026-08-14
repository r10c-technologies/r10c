import { describe, expect, it, vi } from 'vitest';

import {
  ALLOW_DEV_SERVER_VAR,
  assertExpectedServer,
  assertExpectedServerOnce,
} from './assert-expected-server';

const BASE_URL = 'http://localhost:3001';

const LIVENESS = '/api/health/live';
const DEV_ASSET = '/_next/static/development/_buildManifest.js';

/**
 * A fake server described by what each path answers. An absent entry is a
 * `404`, which is what a production build serves for the dev asset.
 */
const serving = (routes: Record<string, { body?: unknown; status?: number }>) =>
  vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const match = Object.entries(routes).find(([path]) => url.endsWith(path));
    const { body = {}, status = 200 } = match?.[1] ?? { status: 404 };

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;

const production = () =>
  serving({ [LIVENESS]: { body: { status: 'live', mode: 'production' } } });

const development = () =>
  serving({
    [LIVENESS]: { body: { status: 'live', mode: 'development' } },
    [DEV_ASSET]: { body: {} },
  });

describe('assertExpectedServer', () => {
  it('accepts a production build', async () => {
    await expect(
      assertExpectedServer({
        baseURL: BASE_URL,
        env: {},
        fetchImpl: production(),
      }),
    ).resolves.toBeUndefined();
  });

  // The whole point: the `mock` profile claims to be hermetic, and attached to
  // a dev server it is not. A wrong answer is worse than a slow one.
  it('refuses a development build, naming the port and the fix', async () => {
    const refuse = () =>
      assertExpectedServer({
        baseURL: BASE_URL,
        env: {},
        fetchImpl: development(),
      });

    await expect(refuse()).rejects.toThrow(BASE_URL);
    await expect(refuse()).rejects.toThrow(ALLOW_DEV_SERVER_VAR);
  });

  // `live` expects an already-running app and makes no hermeticity claim, so
  // which build answers is the operator's business.
  it('leaves the live profile alone', async () => {
    const probe = development();

    await assertExpectedServer({
      baseURL: BASE_URL,
      env: { E2E_PROFILE: 'live' },
      fetchImpl: probe,
    });

    expect(probe).not.toHaveBeenCalled();
  });

  it('honours the opt-out', async () => {
    const probe = development();

    await assertExpectedServer({
      baseURL: BASE_URL,
      env: { [ALLOW_DEV_SERVER_VAR]: '1' },
      fetchImpl: probe,
    });

    expect(probe).not.toHaveBeenCalled();
  });

  it('ignores an empty opt-out', async () => {
    await expect(
      assertExpectedServer({
        baseURL: BASE_URL,
        env: { [ALLOW_DEV_SERVER_VAR]: '' },
        fetchImpl: development(),
      }),
    ).rejects.toThrow(Error);
  });

  // An app that does not expose liveness is not a reason to refuse to test it.
  it('warns and continues when the probe cannot be reached', async () => {
    const warn = vi.fn();

    await assertExpectedServer({
      baseURL: BASE_URL,
      env: {},
      fetchImpl: (() =>
        Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
      warn,
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(BASE_URL));
  });

  // The case that defeated the first version of this guard, measured on
  // 2026-08-14: `nx e2e` builds into the same `.next` the running dev server
  // owns, corrupting its Turbopack cache, so every app route — liveness
  // included — starts answering `500`. Asking Next for a dev-only asset needs no
  // cooperation from the app and still catches it.
  it('catches a dev server whose own routes have stopped answering', async () => {
    await expect(
      assertExpectedServer({
        baseURL: BASE_URL,
        env: {},
        fetchImpl: serving({
          [LIVENESS]: { status: 500 },
          [DEV_ASSET]: { body: {} },
        }),
      }),
    ).rejects.toThrow(Error);
  });

  it('accepts a production build that serves no dev asset', async () => {
    await expect(
      assertExpectedServer({
        baseURL: BASE_URL,
        env: {},
        fetchImpl: serving({ [LIVENESS]: { status: 500 } }),
      }),
    ).resolves.toBeUndefined();
  });

  // A liveness endpoint that answers without naming a build falls through to
  // the second signal rather than being trusted.
  it('falls through when the probe names no build', async () => {
    await expect(
      assertExpectedServer({
        baseURL: BASE_URL,
        env: {},
        fetchImpl: serving({
          [LIVENESS]: { body: { status: 'live' } },
          [DEV_ASSET]: { body: {} },
        }),
      }),
    ).rejects.toThrow(Error);
  });

  it('warns through the console by default', async () => {
    const console_ = vi.spyOn(console, 'warn').mockImplementation(() => void 0);

    await assertExpectedServer({
      baseURL: BASE_URL,
      env: {},
      fetchImpl: (() =>
        Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });

    expect(console_).toHaveBeenCalled();
    console_.mockRestore();
  });
});

describe('assertExpectedServerOnce', () => {
  it('does nothing without a base URL to check', async () => {
    await expect(assertExpectedServerOnce(undefined)).resolves.toBeUndefined();
    await expect(assertExpectedServerOnce('')).resolves.toBeUndefined();
  });

  // The fixture runs per test; the server cannot change mid-run, so the probe
  // happens once and every later test rejects with the same cached error.
  it('probes once and reuses the verdict', async () => {
    const probe = development();
    vi.stubGlobal('fetch', probe);

    await expect(assertExpectedServerOnce(BASE_URL)).rejects.toThrow(Error);
    await expect(assertExpectedServerOnce(BASE_URL)).rejects.toThrow(Error);

    expect(probe).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
