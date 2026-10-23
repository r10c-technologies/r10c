import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@entifix/testing-unit';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { getOffering, loadOfferings } from './offerings.js';

/**
 * These run the generic load use case over an in-memory repository, so what is
 * under test is the request each read builds — never a transport. The wiring
 * the storefront ships, and the RSQL it turns these requests into, is the
 * shell's spec.
 */

const offering = (offeringId: string, name: string, categoryId?: string) => {
  const one = new PublishedOffering(offeringId, 'vendor-1', name);
  one.id = offeringId;
  one.amount = 1999;
  one.currency = 'GTQ';
  one.availableHint = true;
  one.publishedAt = new Date('2026-01-01T00:00:00.000Z');
  if (categoryId !== undefined) one.categoryId = categoryId;
  return one;
};

const OFFERINGS = [
  offering('offering-1', 'Lámpara Aurora', 'category-lighting'),
  offering('offering-2', 'Taza Terra', 'category-tableware'),
];

const run = <A>(
  read: Effect.Effect<
    A,
    unknown,
    EntityRepositoryTag | ConfigurationRepositoryTag
  >,
) => {
  const repository = makeInMemoryEntityRepository(OFFERINGS);
  const load = vi.spyOn(repository, 'load');
  const result = Effect.runPromise(
    read.pipe(
      Effect.provide(
        Context.merge(
          Context.make(EntityRepositoryTag, repository),
          Context.make(
            ConfigurationRepositoryTag,
            makeStubConfigurationClient(),
          ),
        ),
      ),
    ) as Effect.Effect<A>,
  );
  return { result, load };
};

describe('loadOfferings', () => {
  it('returns the projected offerings, unfiltered by default', async () => {
    const { result, load } = run(loadOfferings());

    expect((await result).total).toBe(2);
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ filtering: undefined, sorting: undefined }),
    );
  });

  it('filters on the categoryId it is handed', async () => {
    const { result } = run(loadOfferings({ categoryId: 'category-lighting' }));

    expect((await result).items.map(item => item.offeringId)).toEqual([
      'offering-1',
    ]);
  });

  it('matches a search term against the name', async () => {
    const { load } = run(loadOfferings({ search: 'Taza' }));

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [{ property: 'name', operator: 'like', value: 'Taza' }],
      }),
    );
  });

  it('sends the sort, the direction and the page', async () => {
    const { load } = run(
      loadOfferings({ sort: 'code', direction: 'desc', page: 2, pageSize: 6 }),
    );

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 6,
        sorting: [{ 0: { property: 'code', type: 'desc' } }],
      }),
    );
  });

  it('sorts ascending when no direction is named', async () => {
    const { load } = run(loadOfferings({ sort: 'name' }));

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        sorting: [{ 0: { property: 'name', type: 'asc' } }],
      }),
    );
  });
});

describe('getOffering', () => {
  it('filters on offeringId rather than fetching by id', async () => {
    const { result, load } = run(getOffering('offering-2'));

    expect((await result)?.name).toBe('Taza Terra');
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [
          { property: 'offeringId', operator: 'eq', value: 'offering-2' },
        ],
        pageSize: 1,
      }),
    );
  });

  it('is undefined for an unknown id, so the route can 404', async () => {
    const { result } = run(getOffering('offering-gone'));

    expect(await result).toBeUndefined();
  });
});
