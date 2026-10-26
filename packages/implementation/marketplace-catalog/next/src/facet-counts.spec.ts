import { EntityFacetCounterTag } from '@entifix/business';
import { makeInMemoryFacetCounter } from '@entifix/testing-unit';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  loadOfferingFacetCounts,
  offeringFacetQueries,
  rollUpFacet,
} from './facet-counts.js';
import { parseSearch } from './search-query.js';

const context = { subtreeOf: (id: string) => [id] };

const offering = (
  id: string,
  brandId: string,
  vendorId: string,
  categoryId: string,
) =>
  Object.assign(new PublishedOffering(id, vendorId, id), {
    id,
    brandId,
    categoryId,
  });

const ROWS = [
  offering('o-1', 'brand-a', 'v-1', 'c-lamps'),
  offering('o-2', 'brand-a', 'v-2', 'c-mugs'),
  offering('o-3', 'brand-t', 'v-1', 'c-mugs'),
];

const countsFor = (query: Record<string, string | string[]>) =>
  Effect.runPromise(
    loadOfferingFacetCounts(parseSearch(query), context).pipe(
      Effect.provideService(
        EntityFacetCounterTag,
        makeInMemoryFacetCounter(ROWS),
      ),
    ),
  );

describe('offeringFacetQueries', () => {
  it('counts each facet under the search without its own choice', () => {
    const queries = offeringFacetQueries(
      parseSearch({ brand: 'brand-a', seller: 'v-1' }),
      context,
    );

    expect(queries.map(query => query.member)).toEqual([
      'categoryId',
      'brandId',
      'vendorId',
    ]);
    const brand = JSON.stringify(queries[1]?.filtering);
    const seller = JSON.stringify(queries[2]?.filtering);
    expect(brand).toContain('vendorId');
    expect(brand).not.toContain('brandId');
    expect(seller).toContain('brandId');
    expect(seller).not.toContain('vendorId');
  });

  it('sends no filtering for a facet when nothing else is in force', () => {
    expect(offeringFacetQueries(parseSearch({}), context, ['brand'])).toEqual([
      { member: 'brandId' },
    ]);
  });
});

describe('loadOfferingFacetCounts', () => {
  it('keeps every other brand its count when one brand is chosen', async () => {
    const counts = await countsFor({ brand: 'brand-a' });

    expect(counts.brand).toEqual([
      { value: 'brand-a', count: 2 },
      { value: 'brand-t', count: 1 },
    ]);
    // The sellers are counted within the chosen brand.
    expect(counts.seller).toEqual([
      { value: 'v-1', count: 1 },
      { value: 'v-2', count: 1 },
    ]);
  });

  it('keys the counts by facet, and answers a facet nothing holds empty', async () => {
    const counts = await Effect.runPromise(
      loadOfferingFacetCounts(parseSearch({}), context, ['category']).pipe(
        Effect.provideService(EntityFacetCounterTag, {
          count: () => Effect.succeed({}),
        }),
      ),
    );

    expect(counts).toEqual({ category: [] });
  });
});

describe('rollUpFacet', () => {
  it('sums each group from its members, 0 for a group nothing was counted in', () => {
    expect(
      rollUpFacet(
        [
          { value: 'c-lamps', count: 1 },
          { value: 'c-mugs', count: 2 },
        ],
        {
          'c-home': ['c-home', 'c-lamps', 'c-mugs'],
          'c-garden': ['c-garden'],
        },
      ),
    ).toEqual([
      { value: 'c-home', count: 3 },
      { value: 'c-garden', count: 0 },
    ]);
  });
});
