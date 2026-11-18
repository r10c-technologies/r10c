import { afterEach, describe, expect, it, vi } from 'vitest';

import { readBuyerReceipt } from './receipt-read';

const answer = (response: Response) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  );

const unreachable = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readBuyerReceipt', () => {
  it('reads the group back by its capability, never from a cache', async () => {
    answer(new Response(JSON.stringify({ group: { data: { id: 'g/1' } } })));

    expect(await readBuyerReceipt('g/1', 'nonce')).toEqual({
      group: { data: { id: 'g/1' } },
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/checkout-group\/g%2F1\/buyer-receipt$/);
    expect(init).toMatchObject({
      headers: { 'x-cancel-nonce': 'nonce' },
      cache: 'no-store',
    });
  });

  it('answers nothing for a refusal or an unreachable service', async () => {
    answer(new Response('{}', { status: 401 }));
    expect(await readBuyerReceipt('g-1', 'nonce')).toBeUndefined();

    unreachable();
    expect(await readBuyerReceipt('g-1', 'nonce')).toBeUndefined();
  });
});
