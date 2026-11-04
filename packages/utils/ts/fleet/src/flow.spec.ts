import { afterEach, describe, expect, it, vi } from 'vitest';

import { CROSSING_TOKEN_HEADER, postFlow } from './flow.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postFlow', () => {
  it('posts the start input with the crossing token and answers the coordinator’s status, type and body', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ meta: { type: 'flowAccepted' } }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const answer = await postFlow(
      'http://coordinator/api',
      'token',
      'checkout',
      { vendors: [] },
      'key-"1"',
      { cache: 'no-store' },
    );

    expect(answer).toEqual({
      status: 202,
      contentType: 'application/json',
      payload: { meta: { type: 'flowAccepted' } },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://coordinator/api/flow/checkout',
      {
        cache: 'no-store',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CROSSING_TOKEN_HEADER]: 'token',
          'idempotency-key': '"key-\\"1\\""',
        },
        body: JSON.stringify({ vendors: [] }),
      },
    );
  });

  it('answers a body that will not parse as undefined, and no content type as undefined', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(null, { status: 500 })),
    );

    expect(await postFlow('http://c', 't', 'cancellation', {}, 'k')).toEqual({
      status: 500,
      contentType: undefined,
      payload: undefined,
    });
  });
});
