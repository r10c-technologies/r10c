import { InMemoryRetryBudgetLayer } from '@entifix/transactions/engine';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpVendorFactsLayer, VendorFactsTag } from './vendor-facts.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const urls: string[] = [];

/** Serves `fetch` from a script: `undefined` is a peer that cannot be reached. */
const serve = (answer: () => { status: number; body?: string } | undefined) =>
  vi.stubGlobal('fetch', (input: string) => {
    urls.push(input);
    const answered = answer();
    return answered === undefined
      ? Promise.reject(new Error('refused'))
      : Promise.resolve(
          new Response(answered.body ?? null, { status: answered.status }),
        );
  });

const factsOf = (vendorIds: readonly string[]) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(VendorFactsTag, facts =>
        facts.entitlementsOf(vendorIds),
      ).pipe(
        Effect.provide(
          httpVendorFactsLayer('http://catalog/api').pipe(
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
    ),
  );

describe('httpVendorFactsLayer', () => {
  it('reads each vendor’s commerce facts as the entitlements they stand for', async () => {
    urls.length = 0;
    serve(() => ({
      status: 200,
      body: JSON.stringify({
        data: {
          items: [
            { vendorId: 'v-1', holdsStock: true, acceptsCod: true },
            { vendorId: 'v-2', holdsStock: true, acceptsCod: false },
            { vendorId: 'v-4', acceptsCod: true },
          ],
        },
      }),
    }));

    const outcome = await factsOf(['v-1', 'v-2', 'v-3', 'v-4']);

    expect(outcome).toMatchObject({ _tag: 'Success' });
    expect(
      Object.fromEntries(
        (outcome as { success: ReadonlyMap<string, unknown> }).success,
      ),
    ).toEqual({
      'v-1': ['stock-management', 'shipping-order-management'],
      'v-2': ['stock-management'],
      'v-3': [],
      'v-4': ['shipping-order-management'],
    });
    expect(urls[0]).toBe(
      `http://catalog/api/published-vendor?rsql=${encodeURIComponent('vendorId=in=(v-1,v-2,v-3,v-4)')}&pageSize=4`,
    );
  });

  it('holds a vendor to nothing when the projection answers no items', async () => {
    serve(() => ({ status: 200, body: JSON.stringify({}) }));

    const outcome = await factsOf(['v-1']);

    expect(outcome).toMatchObject({ _tag: 'Success' });
    expect(
      Object.fromEntries(
        (outcome as { success: ReadonlyMap<string, unknown> }).success,
      ),
    ).toEqual({ 'v-1': [] });
  });

  it.each([
    ['a projection that cannot be reached', () => undefined],
    ['a 5xx', () => ({ status: 503 })],
    ['a body that is not JSON', () => ({ status: 200, body: 'nope' })],
  ])('answers %s as an unavailable upstream, not as no entitlements', async (_label, answer) => {
    serve(answer);

    expect(await factsOf(['v-1'])).toMatchObject({
      failure: { _tag: 'UpstreamUnavailable', upstream: 'marketplace-service' },
    });
  });
});
