import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runReferenceBulk } from './catalog-crud.js';

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
