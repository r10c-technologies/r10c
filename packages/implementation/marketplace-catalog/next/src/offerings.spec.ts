import { EntityRepositoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  getKitComponents,
  getOffering,
  getVariantCounts,
  getVariantSiblings,
  loadOfferings,
  searchOfferings,
} from './offerings.js';
import { parseSearch } from './search-query.js';

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

const run = <A>(read: Effect.Effect<A, unknown, EntityRepositoryTag>) => {
  const repository = makeInMemoryEntityRepository(OFFERINGS);
  const load = vi.spyOn(repository, 'load');
  const result = Effect.runPromise(
    read.pipe(
      Effect.provide(Context.make(EntityRepositoryTag, repository)),
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

  it('filters on the category ids it is handed', async () => {
    const { result } = run(
      loadOfferings({ categoryIds: ['category-lighting'] }),
    );

    expect((await result).items.map(item => item.offeringId)).toEqual([
      'offering-1',
    ]);
  });

  /** ADR 0062: a category page asks for its whole subtree at once. */
  it('matches an offering in any of the categories', async () => {
    const { load } = run(
      loadOfferings({ categoryIds: ['category-lighting', 'category-desk'] }),
    );

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [
          {
            property: 'categoryId',
            operator: 'in',
            values: ['category-lighting', 'category-desk'],
          },
        ],
      }),
    );
  });

  it('matches every word of a search term against the search text', async () => {
    const { load } = run(loadOfferings({ search: 'Taza azul' }));

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [
          { property: 'searchText', operator: 'like', value: 'Taza' },
          { property: 'searchText', operator: 'like', value: 'azul' },
        ],
      }),
    );
  });

  it('asks for in-stock offerings only when told to', async () => {
    const { load } = run(loadOfferings({ availableOnly: true }));

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [{ property: 'availableHint', operator: 'eq', value: true }],
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

describe('getVariantSiblings', () => {
  it('reads the seller’s offerings in the same variant group', async () => {
    const { load } = run(
      getVariantSiblings({ vendorId: 'org-1', variantGroup: 'P-0001' }),
    );

    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [
          { property: 'vendorId', operator: 'eq', value: 'org-1' },
          { property: 'variantGroup', operator: 'eq', value: 'P-0001' },
        ],
      }),
    );
  });

  it('reads nothing for an offering in no group', async () => {
    const { result, load } = run(
      getVariantSiblings({ vendorId: 'org-1', variantGroup: undefined }),
    );

    expect(await result).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});

const over = <A>(
  rows: PublishedOffering[],
  read: Effect.Effect<A, unknown, EntityRepositoryTag>,
) => {
  const repository = makeInMemoryEntityRepository(rows);
  const load = vi.spyOn(repository, 'load');
  const result = Effect.runPromise(
    read.pipe(
      Effect.provide(Context.make(EntityRepositoryTag, repository)),
    ) as Effect.Effect<A>,
  );
  return { result, load };
};

describe('getKitComponents', () => {
  const kase = offering('case', 'Funda');
  const film = offering('film', 'Protector');

  it('reads a kit’s published components in the kit’s order, leaving off one taken down', async () => {
    const { result } = over(
      [kase, film],
      getKitComponents({
        vendorId: 'vendor-1',
        kitComponents: [
          {
            offeringId: 'film',
            quantity: 2,
            stockOfferingId: 'film',
            stockUnit: 'UN',
            stockQuantity: 2,
          },
          {
            offeringId: 'gone',
            quantity: 1,
            stockOfferingId: 'gone',
            stockUnit: 'UN',
            stockQuantity: 1,
          },
          {
            offeringId: 'case',
            quantity: 1,
            stockOfferingId: 'case',
            stockUnit: 'UN',
            stockQuantity: 1,
          },
        ],
      }),
    );

    expect((await result).map(one => one.offeringId)).toEqual(['film', 'case']);
  });

  it('reads nothing for an offering that is no kit', async () => {
    const { result, load } = over(
      [kase],
      getKitComponents({ vendorId: 'vendor-1', kitComponents: undefined }),
    );

    expect(await result).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('getVariantCounts', () => {
  const variant = (id: string, group: string) =>
    Object.assign(offering(id, id), { variantGroup: group });

  it('counts each group on the page in one read', async () => {
    const { result, load } = over(
      [
        variant('a', 'g1'),
        variant('b', 'g1'),
        variant('c', 'g2'),
        offering('d', 'd'),
      ],
      getVariantCounts([
        { variantGroup: 'g1' },
        { variantGroup: 'g1' },
        { variantGroup: 'g2' },
        { variantGroup: undefined },
      ]),
    );

    expect([...(await result)]).toEqual([
      ['g1', 2],
      ['g2', 1],
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for a page with no variant', async () => {
    const { result, load } = over(
      [],
      getVariantCounts([{ variantGroup: undefined }]),
    );

    expect((await result).size).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('searchOfferings', () => {
  it('reads the page the search address states, through the codec', async () => {
    const { result, load } = run(
      searchOfferings(parseSearch({ category: 'category-lighting' }, 'es'), {
        subtreeOf: id => [id],
      }),
    );

    expect((await result).items.map(item => item.offeringId)).toEqual([
      'offering-1',
    ]);
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [
          {
            property: 'categoryId',
            operator: 'in',
            values: ['category-lighting'],
          },
        ],
      }),
    );
  });
});
