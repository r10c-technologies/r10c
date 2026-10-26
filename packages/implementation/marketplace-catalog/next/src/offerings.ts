import { EntityRepositoryTag } from '@entifix/business';
import type {
  EntifixError,
  EntityFilter,
  EntityLoadRequest,
  EntityPage,
} from '@entifix/core';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Effect } from 'effect';

import {
  type SearchContext,
  searchRequest,
  type SearchState,
} from './search-query.js';

/**
 * What every read here requires: the `PublishedOffering` repository, and
 * nothing else. Which transport answers is the caller's choice, made at
 * composition.
 */
export type OfferingRead<A> = Effect.Effect<
  A,
  EntifixError,
  EntityRepositoryTag
>;

export interface OfferingQuery {
  /**
   * Category **ids**, as the projection stores them: an offering in any of
   * them matches. A category page passes its whole subtree (ADR 0062), a
   * related-products strip passes one.
   *
   * Not codes: a URL carries the code, and resolving it is a read of the
   * reference vocabulary — another domain's store, so another cell. The caller
   * resolves the slug and the tree and hands the ids over, and an unknown slug
   * never reaches this read at all.
   */
  readonly categoryIds?: readonly string[];
  /** Free text, matched against the offering name. */
  readonly search?: string;
  /**
   * Only offerings the projection says are in stock — a hint, not a promise
   * (ADR 0010). The home page's featured strip asks for it, because a shop
   * window full of "Sin existencias" sells nothing.
   */
  readonly availableOnly?: boolean;
  /**
   * A `sortable` member of `PublishedOffering`. The home page's newest strip
   * sorts on `publishedAt`, descending.
   */
  readonly sort?: 'name' | 'code' | 'amount' | 'publishedAt';
  readonly direction?: 'asc' | 'desc';
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Every read here, straight through the repository: the load use case's tag
 * carries no entity type, so going through it would need a cast that the
 * typed `repository.load<PublishedOffering>` does not.
 */
const load = (
  request: EntityLoadRequest<PublishedOffering>,
): OfferingRead<EntityPage<PublishedOffering>> =>
  Effect.gen(function* () {
    const repository = yield* EntityRepositoryTag;
    return yield* repository.load<PublishedOffering>(request);
  });

/** The published catalog, filtered the way the query asks. */
export const loadOfferings = (
  query: OfferingQuery = {},
): OfferingRead<EntityPage<PublishedOffering>> => {
  const filtering: EntityFilter<PublishedOffering>[] = [
    ...(query.categoryIds !== undefined
      ? [
          {
            property: 'categoryId',
            operator: 'in',
            values: [...query.categoryIds],
          } satisfies EntityFilter<PublishedOffering>,
        ]
      : []),
    ...(query.search
      ? [
          {
            property: 'name',
            operator: 'like',
            value: query.search,
          } satisfies EntityFilter<PublishedOffering>,
        ]
      : []),
    ...(query.availableOnly
      ? [
          {
            property: 'availableHint',
            operator: 'eq',
            value: true,
          } satisfies EntityFilter<PublishedOffering>,
        ]
      : []),
  ];

  return load({
    page: query.page,
    pageSize: query.pageSize,
    sorting: query.sort
      ? [{ 0: { property: query.sort, type: query.direction ?? 'asc' } }]
      : undefined,
    filtering: filtering.length > 0 ? filtering : undefined,
  });
};

/**
 * One page of a search or a category listing, as its address states it: the
 * request is the codec's (`searchRequest`), so the URL and the read can never
 * disagree about what a parameter means.
 */
export const searchOfferings = (
  state: SearchState,
  context: SearchContext,
): OfferingRead<EntityPage<PublishedOffering>> =>
  load(searchRequest(state, context));

/**
 * One published offering by the id the URL slug carries.
 *
 * ⚠️ **`load` with a filter, never `get`** (ADR 0049). `PublishedOffering.id`
 * *is* the offering id — the projector assigns it — so a `get` would resolve;
 * it would also turn a 404 page and a datastore outage into the same
 * `EntifixConnError`, which is how every visitor gets told the product does not
 * exist during an incident. `offeringId` is declared `filterable` for exactly
 * this read.
 */
export const getOffering = (
  offeringId: string,
): OfferingRead<PublishedOffering | undefined> =>
  load({
    filtering: [{ property: 'offeringId', operator: 'eq', value: offeringId }],
    pageSize: 1,
  }).pipe(Effect.map(page => page.items[0]));
