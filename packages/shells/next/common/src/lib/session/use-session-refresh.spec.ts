import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionRefresh } from './use-session-refresh';

/** `tokenTtlSeconds: 10` → an 8s period, so a tick is one short hop. */
const ACTIVE_TTL = 10;
const ACTIVE_PERIOD_MS = 8_000;

/**
 * A period longer than `CLIENT_IDLE_STOP_SECONDS` (15 min), so the very first
 * tick already looks like an abandoned tab.
 */
const IDLE_TTL = 2_000;
const IDLE_PERIOD_MS = 1_600_000;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSessionRefresh', () => {
  it('refreshes on schedule while the user is present', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, sessionExpiresIn: 604_800 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useSessionRefresh({ tokenTtlSeconds: ACTIVE_TTL }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.current.sessionExpiresIn).toBe(604_800);
    expect(result.current.expiringSoon).toBe(false);
  });

  it('stops refreshing once the user has gone idle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useSessionRefresh({ tokenTtlSeconds: IDLE_TTL }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_PERIOD_MS);
    });

    // This is what makes the idle timeout mean anything: a forgotten tab must
    // not keep renewing the session on the server.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resumes after the user interacts again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useSessionRefresh({ tokenTtlSeconds: IDLE_TTL }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_PERIOD_MS);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Land the interaction just before the next tick, so the tick sees a recent
    // `lastActivity` rather than a whole period's worth of silence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_PERIOD_MS - 10_000);
    });
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('flags an expired session and notifies once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'sessionExpired' }, 401)),
    );
    const onExpired = vi.fn();

    const { result } = renderHook(() =>
      useSessionRefresh({ tokenTtlSeconds: ACTIVE_TTL, onExpired }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS * 3);
    });

    expect(result.current.expired).toBe(true);
    // The interval is torn down on expiry, so this fires once no matter how
    // many periods elapse.
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('keeps trying after a transient failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'network' }, 503))
      .mockResolvedValue(jsonResponse({ ok: true, sessionExpiresIn: 120 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useSessionRefresh({ tokenTtlSeconds: ACTIVE_TTL }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS * 2);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.expired).toBe(false);
    // Inside the final five minutes, so the UI can warn before the ceiling.
    expect(result.current.expiringSoon).toBe(true);
  });

  it('survives a thrown request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result } = renderHook(() =>
      useSessionRefresh({ tokenTtlSeconds: ACTIVE_TTL }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS);
    });

    expect(result.current.expired).toBe(false);
    expect(result.current.sessionExpiresIn).toBeUndefined();
  });

  it('ignores a body without a session expiry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));

    const { result } = renderHook(() =>
      useSessionRefresh({ tokenTtlSeconds: ACTIVE_TTL }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS);
    });

    expect(result.current.sessionExpiresIn).toBeUndefined();
  });

  it('drops the in-flight result when unmounted mid-request', async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      ),
    );

    const { result, unmount } = renderHook(() =>
      useSessionRefresh({ tokenTtlSeconds: ACTIVE_TTL }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS);
    });
    unmount();
    await act(async () => {
      release(jsonResponse({ ok: true, sessionExpiresIn: 42 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Setting state after unmount would be a leak; the cancelled flag stops it.
    expect(result.current.sessionExpiresIn).toBeUndefined();
  });

  it('accepts a custom endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() =>
      useSessionRefresh({
        tokenTtlSeconds: ACTIVE_TTL,
        endpoint: '/custom/refresh',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_PERIOD_MS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/custom/refresh',
      expect.anything(),
    );
  });

  it('uses the default token ttl when none is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useSessionRefresh());

    // Default is a 15-minute token → a 12-minute period.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
