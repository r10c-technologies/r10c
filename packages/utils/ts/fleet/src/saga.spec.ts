import { afterEach, describe, expect, it, vi } from 'vitest';

import { CROSSING_TOKEN_HEADER } from './flow.js';
import { postSaga } from './saga.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postSaga', () => {
  it('posts the inputs with the crossing token and answers the coordinator’s status and body', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sagaId: 's-1' }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const answer = await postSaga(
      'http://coordinator/api',
      'token',
      'checkout',
      { reserve: [] },
      'key-"1"',
      { cache: 'no-store' },
    );

    expect(answer).toEqual({ status: 200, payload: { sagaId: 's-1' } });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://coordinator/api/saga/checkout',
      {
        cache: 'no-store',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CROSSING_TOKEN_HEADER]: 'token',
          'idempotency-key': '"key-\\"1\\""',
        },
        body: JSON.stringify({ inputs: { reserve: [] } }),
      },
    );
  });

  it('answers a body that will not parse as undefined', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('not json', { status: 500 })),
    );

    expect(await postSaga('http://c', 't', 'cancellation', {}, 'k')).toEqual({
      status: 500,
      payload: undefined,
    });
  });
});
