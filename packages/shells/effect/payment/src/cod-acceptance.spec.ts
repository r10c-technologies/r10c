import { InMemoryRetryBudgetLayer } from '@entifix/transactions/engine';
import { CodAcceptanceTag } from '@r10c/business-ts-payment-management';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpCodAcceptanceLayer } from './cod-acceptance.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const urls: string[] = [];

/** Serves `fetch` from a script: `undefined` is a peer that cannot be reached. */
const serve = (answer: () => { status: number; body?: unknown } | undefined) =>
  vi.stubGlobal('fetch', (input: string) => {
    urls.push(input);
    const answered = answer();
    return answered === undefined
      ? Promise.reject(new Error('refused'))
      : Promise.resolve(
          new Response(
            answered.body === undefined ? null : JSON.stringify(answered.body),
            { status: answered.status },
          ),
        );
  });

const accepts = (vendorId: string) =>
  Effect.runPromise(
    Effect.flatMap(CodAcceptanceTag, acceptance =>
      acceptance.acceptsCod(vendorId),
    ).pipe(
      Effect.provide(
        httpCodAcceptanceLayer('http://catalog/api').pipe(
          Layer.provide(
            InMemoryRetryBudgetLayer({
              dials: {
                backoffBaseMs: 0,
                backoffCapMs: 0,
                budgetFloorPerSecond: 1,
              },
            }),
          ),
        ),
      ),
    ),
  );

describe('httpCodAcceptanceLayer', () => {
  it('reads the seller’s published record by vendor id', async () => {
    urls.length = 0;
    serve(() => ({
      status: 200,
      body: { data: { items: [{ vendorId: 'v-1', acceptsCod: true }] } },
    }));

    expect(await accepts('v-1')).toBe(true);
    expect(urls[0]).toBe(
      'http://catalog/api/published-vendor?rsql=vendorId%3D%3Dv-1&pageSize=1',
    );
  });

  it('treats a seller it does not know, or one without the flag, as not shipping cash on delivery', async () => {
    serve(() => ({ status: 200, body: { data: { items: [] } } }));
    expect(await accepts('v-1')).toBe(false);
    serve(() => ({ status: 404 }));
    expect(await accepts('v-1')).toBe(false);
  });

  it('answers a projection it cannot reach as unavailable, never as a no', async () => {
    serve(() => undefined);
    await expect(accepts('v-1')).rejects.toMatchObject({
      code: 'upstreamUnavailable',
    });
    serve(() => ({ status: 503 }));
    await expect(accepts('v-1')).rejects.toMatchObject({
      code: 'upstreamUnavailable',
    });
  });
});
