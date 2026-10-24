import { describe, expect, it } from 'vitest';

import {
  parseSearch,
  SEARCH_PAGE_SIZE,
  type SearchContext,
  searchHref,
  searchQuery,
  searchRequest,
} from './search-query.js';

const flat: SearchContext = { subtreeOf: id => [id] };

describe('parseSearch', () => {
  it('reads every parameter from what Next hands a page', () => {
    const state = parseSearch({
      q: 'lamp',
      brand: ['b-1', 'b-2'],
      category: 'c-1',
      seller: 'org-1',
      min: '100',
      max: '250.50',
      available: '1',
      sort: 'price-asc',
      page: '3',
    });

    expect(state).toEqual({
      q: ['lamp'],
      brand: ['b-1', 'b-2'],
      category: ['c-1'],
      seller: ['org-1'],
      min: ['100'],
      max: ['250.50'],
      available: ['1'],
      sort: ['price-asc'],
      page: ['3'],
    });
  });

  it('reads the query string itself the same way', () => {
    expect(
      parseSearch(new URLSearchParams('brand=b-1&brand=b-2&q=lamp')),
    ).toEqual(parseSearch({ brand: ['b-1', 'b-2'], q: 'lamp' }));
  });

  it('drops what no link of ours writes', () => {
    const state = parseSearch({
      q: ['first', 'second'],
      category: ['c-1', 'c-2'],
      min: 'abc',
      max: '1.234',
      available: 'yes',
      sort: 'cheapest',
      page: '0',
      unknown: 'x',
      skipped: undefined,
    });

    expect(state).toEqual({
      ...searchQuery.empty,
      q: ['first'],
      category: ['c-1'],
    });
  });

  it('writes page 1 as no page at all', () => {
    expect(parseSearch({ page: '1' }).page).toEqual([]);
  });
});

describe('searchHref', () => {
  const state = parseSearch({ q: 'lamp', brand: 'b-1', page: '4' });

  it('round-trips a state through its own address', () => {
    const href = searchHref('/es/search', state);

    expect(href).toBe('/es/search?q=lamp&brand=b-1&page=4');
    expect(parseSearch(new URLSearchParams(href.split('?')[1]))).toEqual(state);
  });

  it('is the bare path for an empty search', () => {
    expect(searchHref('/es/search', searchQuery.empty)).toBe('/es/search');
  });

  it('goes back to page 1 when a facet changes', () => {
    expect(searchHref('/es/search', state, { brand: ['b-1', 'b-2'] })).toBe(
      '/es/search?q=lamp&brand=b-1&brand=b-2',
    );
  });

  it('goes back to page 1 when the sort changes', () => {
    expect(searchHref('/es/search', state, { sort: ['newest'] })).toBe(
      '/es/search?q=lamp&brand=b-1&sort=newest',
    );
  });

  it('keeps the filters when only the page changes', () => {
    expect(searchHref('/es/search', state, { page: ['5'] })).toBe(
      '/es/search?q=lamp&brand=b-1&page=5',
    );
  });

  it('sets a price range in one link, and drops a price that is not one', () => {
    expect(
      searchHref('/es/search', searchQuery.empty, {
        min: ['10'],
        max: ['ten'],
      }),
    ).toBe('/es/search?min=10');
  });

  it('removes a parameter given no values', () => {
    expect(searchHref('/es/search', state, { brand: [] })).toBe(
      '/es/search?q=lamp',
    );
  });
});

describe('searchRequest', () => {
  it('asks for the first page, unfiltered and in the default order, for no search', () => {
    expect(searchRequest(searchQuery.empty, flat)).toEqual({
      page: 1,
      pageSize: SEARCH_PAGE_SIZE,
    });
  });

  it('turns each parameter into one condition on the projection', () => {
    const request = searchRequest(
      parseSearch({
        q: 'lamp',
        brand: ['b-1', 'b-2'],
        category: 'c-1',
        seller: 'org-1',
        min: '100',
        max: '250.5',
        available: '1',
        page: '2',
      }),
      { subtreeOf: id => [id, `${id}-child`] },
    );

    expect(request).toEqual({
      page: 2,
      pageSize: SEARCH_PAGE_SIZE,
      filtering: [
        { property: 'name', operator: 'like', value: 'lamp' },
        { property: 'brandId', operator: 'in', values: ['b-1', 'b-2'] },
        // The category facet matches the whole subtree (ADR 0062).
        {
          property: 'categoryId',
          operator: 'in',
          values: ['c-1', 'c-1-child'],
        },
        { property: 'vendorId', operator: 'in', values: ['org-1'] },
        // A price is typed in major units and stored in minor ones.
        { property: 'amount', operator: 'gte', value: 10000 },
        { property: 'amount', operator: 'lte', value: 25050 },
        { property: 'availableHint', operator: 'eq', value: true },
      ],
    });
  });

  it.each([
    ['price-asc', 'amount', 'asc'],
    ['price-desc', 'amount', 'desc'],
    ['newest', 'publishedAt', 'desc'],
    ['name', 'name', 'asc'],
  ])('sorts %s by %s %s', (sort, property, type) => {
    expect(searchRequest(parseSearch({ sort }), flat).sorting).toEqual([
      { 0: { property, type } },
    ]);
  });
});
