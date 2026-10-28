import { EntifixConnError } from '@entifix/core';
import { InMemoryRetryBudgetLayer } from '@entifix/transactions/engine';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import { describePublishedPriceReaderContract } from '@r10c/business-ts-catalog-contracts/testing';
import { SagaStarterTag } from '@r10c/business-ts-saga-contracts';
import { describeSagaStarterContract } from '@r10c/business-ts-saga-contracts/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  httpPublishedPriceReaderLayer,
  httpSagaStarterLayer,
} from './http-adapters.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    ),
  );

const start = () =>
  Effect.gen(function* () {
    const starter = yield* SagaStarterTag;
    return yield* starter.start('checkout', {});
  }).pipe(
    Effect.provide(
      httpSagaStarterLayer({
        url: 'http://coordinator/api',
        crossingToken: 't',
      }),
    ),
  );

/** The price reader over `fetch`, under a budget that never waits. */
const priceReaderLayer = (budgetFloorPerSecond = 1) =>
  httpPublishedPriceReaderLayer('http://catalog/api').pipe(
    Layer.provide(
      InMemoryRetryBudgetLayer({
        dials: { backoffBaseMs: 0, backoffCapMs: 0, budgetFloorPerSecond },
      }),
    ),
  );

const priceOf = (offeringId: string, budgetFloorPerSecond?: number) =>
  Effect.gen(function* () {
    const reader = yield* PublishedPriceReaderTag;
    return yield* reader.priceOf(offeringId);
  }).pipe(Effect.provide(priceReaderLayer(budgetFloorPerSecond)));

/** Serves `fetch` from a script: `undefined` is a peer that cannot be reached. */
const serve = (
  answer: (
    url: URL,
    body: unknown,
  ) => { status: number; body?: unknown } | undefined,
) =>
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const answered = answer(
      new URL(input),
      init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    );
    return answered === undefined
      ? Promise.reject(new Error('refused'))
      : Promise.resolve(
          new Response(
            answered.body === undefined ? null : JSON.stringify(answered.body),
            { status: answered.status },
          ),
        );
  });

describeSagaStarterContract('the HTTP saga starter', coordinator => {
  serve((url, body) =>
    coordinator(
      url.pathname.replace('/api/saga/', ''),
      (body as { inputs: never }).inputs,
    ),
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* SagaStarterTag;
    }).pipe(
      Effect.provide(
        httpSagaStarterLayer({
          url: 'http://coordinator/api',
          crossingToken: 't',
        }),
      ),
    ),
  );
});

describePublishedPriceReaderContract('the HTTP price reader', catalog => {
  serve(url => {
    const offeringId = (url.searchParams.get('rsql') ?? '').replace(
      'offeringId==',
      '',
    );
    const answer = catalog(offeringId);
    return answer === undefined
      ? undefined
      : {
          status: answer.status,
          body: { data: { items: answer.record ? [answer.record] : [] } },
        };
  });
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* PublishedPriceReaderTag;
    }).pipe(Effect.provide(priceReaderLayer())),
  );
});

describe('httpSagaStarterLayer', () => {
  it('answers the outcome the coordinator’s status means', async () => {
    respond(409, { stepId: 'reserve' });

    expect(await Effect.runPromise(start())).toEqual({
      _tag: 'compensated',
      result: { stepId: 'reserve' },
    });
  });

  it('reports a coordinator it could not reach as a connection error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('refused')));

    expect(await Effect.runPromise(start().pipe(Effect.flip))).toBeInstanceOf(
      EntifixConnError,
    );
  });
});

describe('httpPublishedPriceReaderLayer', () => {
  it('reads the price off the first published record', async () => {
    respond(200, {
      data: { items: [{ vendorId: 'v-1', amount: 7, currency: 'GTQ' }] },
    });

    expect(await Effect.runPromise(priceOf('o-1'))).toEqual({
      offeringId: 'o-1',
      vendorId: 'v-1',
      amount: 7,
      currency: 'GTQ',
    });
  });

  it('answers nothing when the projection does not', async () => {
    respond(404);

    expect(await Effect.runPromise(priceOf('o-2'))).toBeUndefined();
  });

  it('reports a projection it could not reach as unavailable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('refused')));

    expect(
      await Effect.runPromise(priceOf('o-3').pipe(Effect.flip)),
    ).toMatchObject({ code: 'upstreamUnavailable', category: 'unavailable' });
  });

  it('retries a projection that failed, and reads the price it then answers', async () => {
    let calls = 0;
    serve(() => {
      calls += 1;
      return calls === 1
        ? { status: 503 }
        : {
            status: 200,
            body: {
              data: {
                items: [{ vendorId: 'v-1', amount: 7, currency: 'GTQ' }],
              },
            },
          };
    });

    expect(await Effect.runPromise(priceOf('o-4'))).toMatchObject({
      amount: 7,
    });
    expect(calls).toBe(2);
  });

  // One retry a second is the floor a quiet dependency gets; past it, the
  // budget refuses, so a dependency that is down is not asked a third time.
  it('stops retrying when the budget is spent', async () => {
    let calls = 0;
    serve(() => {
      calls += 1;
      return { status: 503 };
    });

    await Effect.runPromiseExit(priceOf('o-5'));

    expect(calls).toBe(2);
  });

  it('stops retrying after the dialled attempts, whatever the budget', async () => {
    let calls = 0;
    serve(() => {
      calls += 1;
      return { status: 503 };
    });

    await Effect.runPromiseExit(priceOf('o-5', 100));

    expect(calls).toBe(3);
  });

  it('never retries an answer', async () => {
    let calls = 0;
    serve(() => {
      calls += 1;
      return { status: 404 };
    });

    expect(await Effect.runPromise(priceOf('o-6'))).toBeUndefined();
    expect(calls).toBe(1);
  });
});
