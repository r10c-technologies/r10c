import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOrderUseCase } from './order-crud.js';

/**
 * Typed as `fetch` itself so the recorded calls keep their argument tuple — a
 * bare `vi.fn(() => …)` records `[]`, and the assertions below read the URL and
 * the method out of it.
 */
const answering = (body: unknown, status = 200) =>
  vi.fn((..._args: Parameters<typeof fetch>) =>
    Promise.resolve(
      new Response(body === null ? null : JSON.stringify(body), { status }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('runOrderUseCase', () => {
  it('posts to the verb’s own route on the order proxy', async () => {
    const fetchMock = answering({});
    vi.stubGlobal('fetch', fetchMock);

    await runOrderUseCase('fulfil', 'o-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/order/product-order/o-1/fulfil',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  /**
   * ⚠️ **The one verb whose key and route differ, and the difference matters.**
   * order-service also serves `/cancelling`, which is the saga's claim step
   * behind a crossing token — a browser reaching that would take the lock and
   * leave the order stuck there with no refund after it.
   */
  it('sends `cancel` to the entry route and not to the claim step', async () => {
    const fetchMock = answering({});
    vi.stubGlobal('fetch', fetchMock);

    await runOrderUseCase('cancel', 'o-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/order/product-order/o-1/cancellation',
    );
  });

  /**
   * `EntityId` admits a symbol, which a template literal converts by throwing
   * at runtime rather than by failing to compile.
   */
  it('stringifies an id that is not already a string', async () => {
    const fetchMock = answering({});
    vi.stubGlobal('fetch', fetchMock);

    await runOrderUseCase('fulfil', Symbol('o-2'));

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('Symbol(o-2)');
  });

  /**
   * The refusal must reach the form's error slot carrying the service's own
   * `code`, because that is what the shared `errors` catalog resolves — a
   * swallowed `409` leaves the vendor looking at a button that did nothing.
   */
  it('throws the service’s code when the order refuses the verb', async () => {
    vi.stubGlobal(
      'fetch',
      answering(
        { error: 'the order names another vendor', code: 'multiVendorOrder' },
        409,
      ),
    );

    await expect(runOrderUseCase('cancel', 'o-1')).rejects.toMatchObject({
      details: { code: 'multiVendorOrder' },
    });
  });

  it('falls back to a generic code when the body carries none', async () => {
    // A `502` from the proxy is not JSON at all; `unexpected` is in the errors
    // catalog precisely so this renders as a sentence rather than blank.
    vi.stubGlobal('fetch', answering(null, 502));

    await expect(runOrderUseCase('fulfil', 'o-1')).rejects.toMatchObject({
      details: { code: 'unexpected' },
    });
  });
});
