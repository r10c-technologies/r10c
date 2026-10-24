import type { EntityLoadRequest } from '@entifix/core';
import {
  anyOf,
  containing,
  defineUrlQuery,
  type UrlState,
} from '@entifix/react-integration/url-query';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';

import { assertQueryable } from './allowlist.js';

/** How many results one page of a search or a category shows. */
export const SEARCH_PAGE_SIZE = 24;

/**
 * What a search needs from outside this cell, supplied at composition.
 *
 * `subtreeOf` is how a category facet matches its whole subtree (ADR 0062):
 * the tree is `catalog-reference`'s vocabulary, another domain's store and so
 * another cell, which the shell reads and hands over as a function. It answers
 * the category's own id and every id beneath it, and `[id]` alone when the tree
 * is not known.
 */
export interface SearchContext {
  readonly subtreeOf: (categoryId: string) => readonly string[];
}

/**
 * A price as a buyer types it — whole or with two decimals, in the currency's
 * major unit — so `?min=100` is a hundred quetzales, not one.
 */
const PRICE = /^\d+(\.\d{1,2})?$/;

/** Major units in the URL, minor units in the projection (`amount`). */
const toMinorUnits = (price: string): number => Math.round(Number(price) * 100);

/**
 * Every order a listing offers, and the member and direction it sorts by. The
 * value is what the URL carries (`?sort=price-asc`).
 */
const SORTS = {
  'price-asc': ['amount', 'asc'],
  'price-desc': ['amount', 'desc'],
  newest: ['publishedAt', 'desc'],
  name: ['name', 'asc'],
} as const satisfies Readonly<
  Record<string, readonly [keyof PublishedOffering, 'asc' | 'desc']>
>;

export type SearchSort = keyof typeof SORTS;

/** The orders a sort control offers, in the order it shows them. */
export const SEARCH_SORTS = Object.keys(SORTS) as readonly SearchSort[];

// Every member the codec below names, checked against the allowlist the
// service applies. The facets check their own members the same way.
assertQueryable(
  PublishedOffering,
  'sortable',
  Object.values(SORTS).map(([member]) => member),
);
assertQueryable(PublishedOffering, 'filterable', ['name']);

/**
 * The storefront's search address, one codec for every link that changes it.
 *
 * Parsed once on the server from `searchParams` and serialized into every
 * facet, sort and page link, so a link is the state and a page needs no client
 * script to change it. `withParam` drops the page whenever a filter or the sort
 * changes, because page 4 of a narrower answer is usually past its end.
 *
 * Brand, seller and category values are **ids**, as the projection stores
 * them. A readable slug would be a read of another domain's vocabulary per
 * value, and the category route already carries the slug in its path.
 */
export const searchQuery = defineUrlQuery<
  | 'q'
  | 'brand'
  | 'category'
  | 'seller'
  | 'min'
  | 'max'
  | 'available'
  | 'sort'
  | 'page',
  SearchContext
>({
  params: {
    q: { single: true, condition: containing(() => 'name') },
    brand: { condition: anyOf('brandId') },
    category: {
      single: true,
      condition: ([categoryId], { subtreeOf }) => ({
        property: 'categoryId',
        operator: 'in',
        values: [...subtreeOf(categoryId as string)],
      }),
    },
    seller: { condition: anyOf('vendorId') },
    min: {
      single: true,
      condition: ([price]) => ({
        property: 'amount',
        operator: 'gte',
        value: toMinorUnits(price as string),
      }),
    },
    max: {
      single: true,
      condition: ([price]) => ({
        property: 'amount',
        operator: 'lte',
        value: toMinorUnits(price as string),
      }),
    },
    // A toggle: present means "in stock only", and there is no "out of stock
    // only" to ask for, because availability is a hint (ADR 0010).
    available: {
      single: true,
      allowed: ['1'],
      condition: () => ({
        property: 'availableHint',
        operator: 'eq',
        value: true,
      }),
    },
    sort: {
      sorting: Object.fromEntries(
        Object.entries(SORTS).map(([value, [property, type]]) => [
          value,
          [{ 0: { property, type } }],
        ]),
      ),
    },
    page: { pageSize: SEARCH_PAGE_SIZE },
  },
});

export type SearchKey = keyof typeof searchQuery.empty;

/** Every search parameter's values, checked: what one search address says. */
export type SearchState = UrlState<SearchKey>;

/** What Next hands a page as `searchParams`, or the query string itself. */
export type SearchParams =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * `withParam` checks values against `allowed`, which a price cannot use, so a
 * price that is not a number is dropped here instead. A hand-edited `?min=abc`
 * then filters on nothing rather than on `NaN`.
 */
const withValidPrices = (state: SearchState): SearchState => ({
  ...state,
  min: state.min.filter(price => PRICE.test(price)),
  max: state.max.filter(price => PRICE.test(price)),
});

const toSearchString = (params: SearchParams): string => {
  if (params instanceof URLSearchParams) return params.toString();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const each of typeof value === 'string' ? [value] : value) {
      query.append(key, each);
    }
  }
  return query.toString();
};

/** The search a page's `searchParams` ask for, with every value checked. */
export const parseSearch = (params: SearchParams): SearchState =>
  withValidPrices(searchQuery.parse(toSearchString(params)));

/**
 * The address of `state` at `path`, with `change` applied first — one
 * parameter or several, each through `withParam`, so setting a facet, a price
 * range or the sort lands back on page 1. `[]` removes a parameter.
 */
export const searchHref = (
  path: string,
  state: SearchState,
  change: Partial<Record<SearchKey, readonly string[]>> = {},
): string => {
  let next = state;
  for (const [key, values] of Object.entries(change) as [
    SearchKey,
    readonly string[],
  ][]) {
    next = searchQuery.withParam(next, key, values);
  }
  return `${path}${searchQuery.serialize(withValidPrices(next))}`;
};

/**
 * The load request a search stands for: one condition per parameter set, the
 * chosen sort, and the page. Every member it names must be `filterable` (or
 * `sortable`) on `PublishedOffering`, or the service answers `400`.
 */
export const searchRequest = (
  state: SearchState,
  context: SearchContext,
): EntityLoadRequest<PublishedOffering> =>
  searchQuery.request<PublishedOffering>(state, context);
