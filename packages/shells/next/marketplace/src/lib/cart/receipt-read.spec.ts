import { afterEach, describe, expect, it, vi } from 'vitest';

import { readBuyerReceiptAnswer } from './receipt-read';

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

describe('readBuyerReceiptAnswer', () => {
  it('reads the group back by its capability, never from a cache', async () => {
    answer(new Response(JSON.stringify({ group: { data: { id: 'g/1' } } })));

    expect(await readBuyerReceiptAnswer('g/1', 'nonce')).toEqual({
      kind: 'read',
      body: { group: { data: { id: 'g/1' } } },
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/checkout-group\/g%2F1\/buyer-receipt$/);
    expect(init).toMatchObject({
      headers: { 'x-cancel-nonce': 'nonce' },
      cache: 'no-store',
    });
  });

  it('tells a refused capability from a service that did not answer', async () => {
    answer(new Response('{}', { status: 401 }));
    expect(await readBuyerReceiptAnswer('g-1', 'nonce')).toEqual({
      kind: 'refused',
    });

    answer(new Response('{}', { status: 503 }));
    expect(await readBuyerReceiptAnswer('g-1', 'nonce')).toEqual({
      kind: 'failed',
    });

    unreachable();
    expect(await readBuyerReceiptAnswer('g-1', 'nonce')).toEqual({
      kind: 'failed',
    });
  });
});
