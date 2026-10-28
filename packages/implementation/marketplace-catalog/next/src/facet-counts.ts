import {
  type EntityFacetCounterTag,
  facetCountsUCFactory,
} from '@entifix/business';
import type {
  EntityFacetQuery,
  EntityFacetValue,
  TransitionalFailure,
} from '@entifix/core';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Effect } from 'effect';

import { OFFERING_FACET_MEMBERS } from './offering-facets.js';
import {
  type SearchContext,
  type SearchKey,
  searchRequest,
  type SearchState,
} from './search-query.js';

/** The facets a listing counts: the checkbox ones, whose options are values. */
export type CountedFacet = 'category' | 'brand' | 'seller';

export const COUNTED_FACETS: readonly CountedFacet[] = [
  'category',
  'brand',
  'seller',
];

/** How many results each value of each counted facet would keep. */
export type OfferingFacetCounts = Partial<
  Readonly<Record<CountedFacet, readonly EntityFacetValue[]>>
>;

/**
 * One count per facet, each under the search **minus that facet's own
 * choice** — so choosing one brand leaves every other brand its number, and
 * the panel can still be used after the first click. Every other filter in
 * force (the term, the other facets, the price, the toggle) narrows the
 * count, as it narrows the listing beside it.
 *
 * The filtering is the codec's (`searchRequest`), so a count and the page it
 * sits beside can never disagree about what a parameter means.
 */
export const offeringFacetQueries = (
  state: SearchState,
  context: SearchContext,
  facets: readonly CountedFacet[] = COUNTED_FACETS,
): EntityFacetQuery<PublishedOffering>[] =>
  facets.map(facet => {
    const { filtering } = searchRequest(
      { ...state, [facet satisfies SearchKey]: [], page: [], sort: [] },
      context,
    );
    return {
      member: OFFERING_FACET_MEMBERS[facet],
      ...(filtering === undefined ? {} : { filtering }),
    };
  });

/**
 * The counts for a search, keyed by facet rather than by the member the
 * projection stores, from whichever counter the caller provides.
 */
export const loadOfferingFacetCounts = (
  state: SearchState,
  context: SearchContext,
  facets: readonly CountedFacet[] = COUNTED_FACETS,
): Effect.Effect<
  OfferingFacetCounts,
  TransitionalFailure,
  EntityFacetCounterTag
> =>
  facetCountsUCFactory(offeringFacetQueries(state, context, facets)).pipe(
    Effect.map(counts =>
      Object.fromEntries(
        facets.map(facet => [
          facet,
          counts[OFFERING_FACET_MEMBERS[facet]] ?? [],
        ]),
      ),
    ),
  );

/**
 * A count per group, each the sum of its members' counts — how a category
 * root is counted, since an offering sits in one node and choosing the root
 * matches its whole subtree (ADR 0062). A group none of whose members was
 * counted is `0`.
 */
export const rollUpFacet = (
  values: readonly EntityFacetValue[],
  groups: Readonly<Record<string, readonly string[]>>,
): EntityFacetValue[] => {
  const byValue = new Map(values.map(({ value, count }) => [value, count]));
  return Object.entries(groups).map(([value, members]) => ({
    value,
    count: members.reduce((sum, member) => sum + (byValue.get(member) ?? 0), 0),
  }));
};
