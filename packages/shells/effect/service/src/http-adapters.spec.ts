import { EntifixConnError } from '@entifix/core';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import { describePublishedPriceReaderContract } from '@r10c/business-ts-catalog-contracts/testing';
import { SagaStarterTag } from '@r10c/business-ts-saga-contracts';
import { describeSagaStarterContract } from '@r10c/business-ts-saga-contracts/testing';
import { Effect } from 'effect';
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

const priceOf = (offeringId: string) =>
  Effect.gen(function* () {
    const reader = yield* PublishedPriceReaderTag;
    return yield* reader.priceOf(offeringId);
  }).pipe(Effect.provide(httpPublishedPriceReaderLayer('http://catalog/api')));

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
    }).pipe(Effect.provide(httpPublishedPriceReaderLayer('http://catalog/api'))),
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

  it('reports a projection it could not reach as a connection error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('refused')));

    expect(
      await Effect.runPromise(priceOf('o-3').pipe(Effect.flip)),
    ).toBeInstanceOf(EntifixConnError);
  });
});
