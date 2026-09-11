import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCatalogBulk, runReferenceBulk } from './catalog-crud.js';

interface Brandish extends Entity {
  id: EntityId;
}

/**
 * Typed as `fetch` itself so the recorded calls keep their argument tuple —
 * a bare `vi.fn(() => …)` records `[]`, and the assertions below read the URL
 * and the body out of it.
 */
const answering = (body: unknown, status = 200) =>
  vi.fn((..._args: Parameters<typeof fetch>) =>
    Promise.resolve(
      new Response(body === null ? null : JSON.stringify(body), { status }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('runReferenceBulk', () => {
  it('posts to the verb’s own route on the host’s proxy', async () => {
    const fetchMock = answering({ data: [] });
    vi.stubGlobal('fetch', fetchMock);

    await runReferenceBulk('product-brand')<Brandish>('retire', {
      mode: 'ids',
      ids: new Set(['b-1']),
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/marketplace/product-brand/retire',
    );
  });

  /**
   * The whole reason `toWireSelection` exists: a `Set` serializes to `{}`, so a
   * selection sent raw would arrive with its ids — or, worse, its exclusions —
   * silently gone, and a `matching` run would act on rows the operator had
   * deliberately taken out.
   */
  it('sends the selection in its array form', async () => {
    const fetchMock = answering({ data: [] });
    vi.stubGlobal('fetch', fetchMock);

    await runReferenceBulk('product-brand')<Brandish>('retire', {
      mode: 'matching',
      total: 3200,
      excluded: new Set(['b-9']),
    });

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;

    expect(body.selection).toEqual({
      mode: 'matching',
      total: 3200,
      excluded: ['b-9'],
    });
  });

  it('returns the per-row outcomes the service reported', async () => {
    vi.stubGlobal(
      'fetch',
      answering({ data: [{ id: 'b-1', ok: false, code: 'alreadyRetired' }] }),
    );

    await expect(
      runReferenceBulk('product-brand')<Brandish>('retire', {
        mode: 'ids',
        ids: new Set(['b-1']),
      }),
    ).resolves.toEqual([{ id: 'b-1', ok: false, code: 'alreadyRetired' }]);
  });

  it('reads a body with no outcomes as none', async () => {
    vi.stubGlobal('fetch', answering({}));

    await expect(
      runReferenceBulk('product-brand')<Brandish>('retire', {
        mode: 'ids',
        ids: new Set(['b-1']),
      }),
    ).resolves.toEqual([]);
  });

  /**
   * Thrown rather than returned as outcomes: a `403` is not something an
   * individual row did. `useEntityBulk` catches it and attributes it across
   * the selection.
   */
  it('throws when the request itself failed', async () => {
    vi.stubGlobal('fetch', answering({ error: 'forbidden' }, 403));

    await expect(
      runReferenceBulk('product-brand')<Brandish>('retire', {
        mode: 'ids',
        ids: new Set(['b-1']),
      }),
    ).rejects.toThrow('403');
  });
});

/**
 * The tenant-plane twin, one level up the path: a record's verb is
 * `/<entity>/<id>/<key>` and a collection's is `/<entity>/<key>` (#216).
 */
describe('runCatalogBulk', () => {
  it('posts the selection to the verb on the collection', async () => {
    const fetchMock = answering({ data: [{ id: 'o-1', ok: true }] });
    vi.stubGlobal('fetch', fetchMock);

    const outcomes = await runCatalogBulk('product-offering')<Brandish>(
      'publish',
      { mode: 'ids', ids: new Set(['o-1']) },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/product-offering/publish',
    );
    expect(outcomes).toEqual([{ id: 'o-1', ok: true }]);
  });

  it('reads a per-row refusal as data, not as a failure', async () => {
    // Twenty offerings where three have no price is neither a success nor a
    // failure. `offeringHasNoPrice` is the outcome this surface produces most.
    const fetchMock = answering({
      data: [
        { id: 'o-1', ok: true },
        { id: 'o-2', ok: false, code: 'offeringHasNoPrice' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcomes = await runCatalogBulk('product-offering')<Brandish>(
      'publish',
      { mode: 'ids', ids: new Set(['o-1', 'o-2']) },
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]).toEqual({
      id: 'o-2',
      ok: false,
      code: 'offeringHasNoPrice',
    });
  });

  it('throws when the request itself failed, so the rows can be attributed', async () => {
    const fetchMock = answering({ error: 'nope', code: 'forbidden' }, 403);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runCatalogBulk('product-offering')<Brandish>('publish', {
        mode: 'ids',
        ids: new Set(['o-1']),
      }),
    ).rejects.toMatchObject({ details: { code: 'forbidden' } });
  });

  it('reads a body with no outcomes as nothing done', async () => {
    const fetchMock = answering({});
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runCatalogBulk('product-offering')<Brandish>('publish', {
        mode: 'ids',
        ids: new Set(['o-1']),
      }),
    ).resolves.toEqual([]);
  });

  it('falls back to an unexpected code when the service names none', async () => {
    const fetchMock = answering({}, 500);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runCatalogBulk('product-offering')<Brandish>('publish', {
        mode: 'ids',
        ids: new Set(['o-1']),
      }),
    ).rejects.toMatchObject({ details: { code: 'unexpected' } });
  });
});
