// r10c's languages, as every bundle that formats or reads a number loads
// them: `es` reads numbers as Guatemala writes them.
import '@r10c/business-ts-i18n/locales';

import { describe, expect, it } from 'vitest';

import {
  everyWord,
  hiddenSearchFields,
  MAX_SEARCH_WORDS,
  parseSearch,
  SEARCH_PAGE_SIZE,
  type SearchContext,
  searchHref,
  searchQuery,
  searchRequest,
  searchWords,
} from './search-query.js';

const flat: SearchContext = { subtreeOf: id => [id] };

describe('parseSearch', () => {
  it('reads every parameter from what Next hands a page', () => {
    const state = parseSearch(
      {
        q: 'lamp',
        brand: ['b-1', 'b-2'],
        category: 'c-1',
        seller: 'org-1',
        min: '100',
        max: '250.50',
        available: '1',
        sort: 'price-asc',
        page: '3',
      },
      'es',
    );

    expect(state).toEqual({
      q: ['lamp'],
      brand: ['b-1', 'b-2'],
      category: ['c-1'],
      seller: ['org-1'],
      model: [],
      min: ['100'],
      max: ['250.5'],
      available: ['1'],
      sort: ['price-asc'],
      page: ['3'],
    });
  });

  it('reads the query string itself the same way', () => {
    expect(
      parseSearch(new URLSearchParams('brand=b-1&brand=b-2&q=lamp'), 'es'),
    ).toEqual(parseSearch({ brand: ['b-1', 'b-2'], q: 'lamp' }, 'es'));
  });

  it('drops what no link of ours writes', () => {
    const state = parseSearch(
      {
        q: ['first', 'second'],
        category: ['c-1', 'c-2'],
        min: 'abc',
        max: '1.234',
        available: 'yes',
        sort: 'cheapest',
        page: '0',
        unknown: 'x',
        skipped: undefined,
      },
      'es',
    );

    expect(state).toEqual({
      ...searchQuery.empty,
      q: ['first'],
      category: ['c-1'],
    });
  });

  it('reads a price typed with either decimal separator', () => {
    const state = parseSearch({ min: '64,99', max: '100' }, 'es');

    expect(state.min).toEqual(['64.99']);
    expect(state.max).toEqual(['100']);
  });

  it.each([
    ['es', '1,000', '1000'],
    ['es', '1,000.50', '1000.5'],
    ['en', '12,500', '12500'],
    ['es', ' 45 ', '45'],
  ] as const)(
    'reads %s grouping as grouping: %s is %s',
    (locale, typed, carried) => {
      expect(parseSearch({ min: typed }, locale).min).toEqual([carried]);
    },
  );

  it('drops a price it could read two ways rather than guessing', () => {
    expect(parseSearch({ min: '1.234' }, 'es').min).toEqual([]);
  });

  it('writes page 1 as no page at all', () => {
    expect(parseSearch({ page: '1' }, 'es').page).toEqual([]);
  });
});

describe('searchHref', () => {
  const state = parseSearch({ q: 'lamp', brand: 'b-1', page: '4' }, 'es');

  it('round-trips a state through its own address', () => {
    const href = searchHref('/es/search', state);

    expect(href).toBe('/es/search?q=lamp&brand=b-1&page=4');
    expect(parseSearch(new URLSearchParams(href.split('?')[1]), 'es')).toEqual(
      state,
    );
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
      parseSearch(
        {
          q: 'lamp',
          brand: ['b-1', 'b-2'],
          category: 'c-1',
          seller: 'org-1',
          min: '100',
          max: '250.5',
          available: '1',
          page: '2',
        },
        'es',
      ),
      { subtreeOf: id => [id, `${id}-child`] },
    );

    expect(request).toEqual({
      page: 2,
      pageSize: SEARCH_PAGE_SIZE,
      filtering: [
        // Every word of the term, against what an offering is searched by
        // (#774).
        {
          operator: 'and',
          values: [{ property: 'searchText', operator: 'like', value: 'lamp' }],
        },
        { property: 'brandId', operator: 'in', values: ['b-1', 'b-2'] },
        // The category facet matches the whole subtree (ADR 0062).
        {
          property: 'categoryId',
          operator: 'in',
          values: ['c-1', 'c-1-child'],
        },
        { property: 'vendorId', operator: 'in', values: ['org-1'] },
        // A price for one unit is typed in major units and compared with
        // what a thousand cost, in minor ones (ADR 0082 §5).
        { property: 'amountPerThousand', operator: 'gte', value: 10_000_000 },
        { property: 'amountPerThousand', operator: 'lte', value: 25_050_000 },
        { property: 'availableHint', operator: 'eq', value: true },
      ],
    });
  });

  it.each([
    ['price-asc', 'amountPerThousand', 'asc'],
    ['price-desc', 'amountPerThousand', 'desc'],
    ['newest', 'publishedAt', 'desc'],
    ['name', 'name', 'asc'],
  ])('sorts %s by %s %s', (sort, property, type) => {
    expect(searchRequest(parseSearch({ sort }, 'es'), flat).sorting).toEqual([
      { 0: { property, type } },
    ]);
  });
});

describe('the buyer’s phone (plan 1.17)', () => {
  it('asks for offerings made for it or for every phone', () => {
    const state = parseSearch({ model: 'dm-1' }, 'es');

    expect(searchRequest(state, flat).filtering).toEqual([
      {
        property: 'fitsDeviceModelIds',
        operator: 'in',
        values: ['dm-1', 'universal'],
      },
    ]);
  });

  it('keeps every other value in a form’s hidden fields, but no page', () => {
    const state = parseSearch({ q: 'funda', model: 'dm-1', page: '3' }, 'es');

    expect(hiddenSearchFields(state, ['model'])).toEqual([['q', 'funda']]);
  });
});

describe('everyWord', () => {
  it('requires every word, in any order, against the search text', () => {
    expect(everyWord('  funda   negra ')).toEqual({
      operator: 'and',
      values: [
        { property: 'searchText', operator: 'like', value: 'funda' },
        { property: 'searchText', operator: 'like', value: 'negra' },
      ],
    });
  });

  it('keeps the first words of a pasted line, and none of a blank one', () => {
    expect(searchWords('a b c d e f g h')).toHaveLength(MAX_SEARCH_WORDS);
    expect(searchWords('   ')).toEqual([]);
  });
});
