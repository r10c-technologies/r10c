import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshSession } from './refresh-session';

describe('refreshSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the refresh route and resolves on success', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    await refreshSession();

    expect(fetch).toHaveBeenCalledWith('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it('rejects when the refresh is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(refreshSession('/elsewhere')).rejects.toThrow('401');
  });
});
