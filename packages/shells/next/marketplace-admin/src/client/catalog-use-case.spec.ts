import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_METADATA, runCatalogUseCase } from './catalog-crud.js';

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

describe('runCatalogUseCase', () => {
  it('posts to the verb’s own route on the catalog proxy', async () => {
    const fetchMock = answering({});
    vi.stubGlobal('fetch', fetchMock);

    await runCatalogUseCase('product-offering')('publish', 'o-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/product-offering/o-1/publish',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  /**
   * `EntityId` admits a symbol, which a template literal converts by throwing
   * at runtime rather than by failing to compile.
   */
  it('stringifies an id that is not already a string', async () => {
    const fetchMock = answering({});
    vi.stubGlobal('fetch', fetchMock);

    await runCatalogUseCase('product-offering')('publish', Symbol('o-2'));

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('Symbol(o-2)');
  });

  /**
   * The refusal must reach the form's error slot carrying the service's own
   * `code`, because that is what the shared `errors` catalog resolves — a
   * swallowed `409` leaves the operator looking at a button that did nothing.
   */
  it('throws the service’s code when the record refuses the move', async () => {
    vi.stubGlobal(
      'fetch',
      answering(
        {
          error: 'illegal offering transition',
          code: 'illegalOfferingTransition',
        },
        409,
      ),
    );

    // The code must ride in `details`, not in the message: `useErrorMessage`
    // resolves `details.code` through the shared `errors` catalog, and a bare
    // message would render an English sentence nobody wrote for a user.
    await expect(
      runCatalogUseCase('product-offering')('unpublish', 'o-1'),
    ).rejects.toMatchObject({
      details: { code: 'illegalOfferingTransition' },
    });
  });

  it('falls back to a generic code when the body carries none', async () => {
    // A `502` from the proxy is not JSON at all; `unexpected` is in the errors
    // catalog precisely so this renders as a sentence rather than blank.
    vi.stubGlobal('fetch', answering(null, 502));

    await expect(
      runCatalogUseCase('product-offering')('publish', 'o-1'),
    ).rejects.toMatchObject({ details: { code: 'unexpected' } });
  });
});

describe('CATALOG_METADATA', () => {
  it('asks the catalog proxy, not the reference one', async () => {
    const fetchMock = answering({
      meta: { type: 'entityMetadata', entity: 'product-offering' },
      data: { actions: ['read'], useCases: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    await CATALOG_METADATA.fetchMetadata(ProductOffering);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/admin/product-offering/$metadata',
    );
  });
});
