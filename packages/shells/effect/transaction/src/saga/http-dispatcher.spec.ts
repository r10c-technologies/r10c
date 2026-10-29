import { EntifixConnError, IDEMPOTENCY_KEY_HEADER } from '@entifix/core';
import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
} from '@entifix/service-shell';
import type { SagaDispatch } from '@entifix/transactions';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeHttpSagaDispatcher } from './http-dispatcher.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const dispatcher = makeHttpSagaDispatcher({
  'stock-service': { baseUrl: 'http://stock', crossingToken: 'stock-token' },
});

const dispatch = (fields: Partial<SagaDispatch> = {}): SagaDispatch =>
  ({
    participant: 'stock-service',
    commandId: 'cmd-1',
    call: { method: 'POST', path: '/api/reservation' },
    body: { offeringId: 'o-1' },
    ...fields,
  }) as SagaDispatch;

/** Answers every call with `status` and `body`, remembering what it was sent. */
const respond = (status: number, body?: unknown) => {
  const sent: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    );
  });
  return sent;
};

describe('the HTTP saga dispatcher', () => {
  it('delivers the step with the crossing token, the command id and the organization', async () => {
    const sent = respond(201, { data: { id: 'r-1' } });

    const answer = await Effect.runPromise(
      dispatcher.dispatch(dispatch({ organizationId: 'acme' })),
    );

    expect(answer).toEqual({
      ok: true,
      status: 201,
      body: { data: { id: 'r-1' } },
    });
    expect(sent[0]?.url).toBe('http://stock/api/reservation');
    expect(sent[0]?.init.headers).toMatchObject({
      [CROSSING_TOKEN_HEADER]: 'stock-token',
      [IDEMPOTENCY_KEY_HEADER]: '"cmd-1"',
      [ORGANIZATION_HEADER]: 'acme',
    });
    expect(sent[0]?.init.body).toBe('{"offeringId":"o-1"}');
  });

  it('answers a refusal as a successful effect carrying the reason, and an empty body as none', async () => {
    respond(409, { code: 'insufficientStock' });
    const refused = await Effect.runPromise(dispatcher.dispatch(dispatch()));
    const sent = respond(204);
    const empty = await Effect.runPromise(
      dispatcher.dispatch(dispatch({ body: undefined })),
    );

    expect(refused).toEqual({
      ok: false,
      status: 409,
      body: { code: 'insufficientStock' },
    });
    expect(empty).toEqual({ ok: true, status: 204, body: undefined });
    expect(sent[0]?.init.body).toBeUndefined();
    expect(sent[0]?.init.headers).not.toHaveProperty(ORGANIZATION_HEADER);
  });

  it('fails the effect for a participant it has no address for, a 5xx, and an undeliverable call', async () => {
    respond(503);
    const failed5xx = await Effect.runPromise(
      Effect.flip(dispatcher.dispatch(dispatch())),
    );
    vi.stubGlobal('fetch', () => Promise.reject(new Error('refused')));
    const undelivered = await Effect.runPromise(
      Effect.flip(dispatcher.dispatch(dispatch())),
    );
    const unknown = await Effect.runPromise(
      Effect.flip(dispatcher.dispatch(dispatch({ participant: 'nobody' }))),
    );

    for (const error of [failed5xx, undelivered, unknown]) {
      expect(error).toBeInstanceOf(EntifixConnError);
    }
  });
});
