import {
  type EntityLoadRequest,
  type Locale,
  parseScaled,
  scaledToDecimal,
} from '@entifix/core';
import {
  anyOf,
  containing,
  defineUrlQuery,
  type UrlState,
} from '@entifix/react-integration/url-query';
import { UNIVERSAL_DEVICE_MODEL } from '@r10c/business-ts-catalog-contracts';
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

/** Decimals a price is typed in: the currency's minor unit. */
const PRICE_SCALE = 2;

/**
 * A price as a search carries it once read: major units, a point before at
 * most two decimals and no grouping — so `?min=100` is a hundred quetzales,
 * not one, and `?min=1000.5` is the same price however the buyer typed it.
 */
const PRICE = /^\d+(\.\d{1,2})?$/;

/** The minor units a carried price stands for. Never through a float. */
const toMinorUnits = (price: string): number => {
  const [whole = '0', fraction = ''] = price.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(PRICE_SCALE, '0'));
};

/**
 * A buyer's price for one unit, as the key it is compared on: what a thousand
 * whole units cost at that price. A list's prices are quoted per one, per
 * hundred or per thousand, and `amountPerThousand` puts them on one scale
 * (ADR 0082 §5) — so `?max=1` keeps Q7.50 the hundred, which is Q0.075 each.
 */
const perThousand = (price: string): number => toMinorUnits(price) * 1000;

/**
 * Every order a listing offers, and the member and direction it sorts by. The
 * value is what the URL carries (`?sort=price-asc`).
 */
const SORTS = {
  'price-asc': ['amountPerThousand', 'asc'],
  'price-desc': ['amountPerThousand', 'desc'],
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
assertQueryable(PublishedOffering, 'filterable', [
  'name',
  'fitsDeviceModelIds',
]);

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
  | 'model'
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
    // The buyer's phone (plan 1.17): an offering made for it, or one that fits
    // every phone. `in` on an array member matches when any element does
    // (entifix 0.23.0), so one condition says both. An offering whose vendor
    // never said which phones it fits is left out, which is the point.
    model: {
      single: true,
      condition: ([modelId]) => ({
        property: 'fitsDeviceModelIds',
        operator: 'in',
        values: [modelId as string, UNIVERSAL_DEVICE_MODEL],
      }),
    },
    min: {
      single: true,
      condition: ([price]) => ({
        property: 'amountPerThousand',
        operator: 'gte',
        value: perThousand(price as string),
      }),
    },
    max: {
      single: true,
      condition: ([price]) => ({
        property: 'amountPerThousand',
        operator: 'lte',
        value: perThousand(price as string),
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
 * price that is not one is dropped here instead. A hand-edited `?min=abc`
 * then filters on nothing rather than on `NaN`.
 */
const validPrices = (prices: readonly string[]) =>
  prices.filter(price => PRICE.test(price));

const withValidPrices = (state: SearchState): SearchState => ({
  ...state,
  min: validPrices(state.min),
  max: validPrices(state.max),
});

/**
 * The prices a submitted range form carries, read in the buyer's locale and
 * written back as {@link PRICE}. The field is text, so `64,99`, `1,000` and
 * `1.000,50` all arrive; `parseScaled` reads each as the locale means it and
 * refuses one it could read two ways, which drops it rather than filtering
 * on a guess (`1,000` is a thousand in `es-GT`, never one).
 */
const readPrices = (prices: readonly string[], locale: Locale) =>
  prices.flatMap(price => {
    const minor = parseScaled(price.trim(), PRICE_SCALE, locale);
    return minor === undefined ? [] : [scaledToDecimal(minor, PRICE_SCALE)];
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

/**
 * Every value in force except `omit`, as the `[name, value]` pairs a GET form
 * carries in hidden inputs, so submitting one control keeps the others. The
 * page always goes: a changed filter starts again at page 1.
 */
export const hiddenSearchFields = (
  state: SearchState,
  omit: readonly SearchKey[],
): ReadonlyArray<readonly [SearchKey, string]> =>
  (Object.entries(state) as [SearchKey, string[]][])
    .filter(([key]) => key !== 'page' && !omit.includes(key))
    .flatMap(([key, values]) => values.map(value => [key, value] as const));

/**
 * The search a page's `searchParams` ask for, with every value checked and
 * each price read in the page's `locale`.
 */
export const parseSearch = (
  params: SearchParams,
  locale: Locale,
): SearchState => {
  const state = searchQuery.parse(toSearchString(params));
  return {
    ...state,
    min: readPrices(state.min, locale),
    max: readPrices(state.max, locale),
  };
};

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
