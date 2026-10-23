import type { ConfigurationRepositoryTag } from '@entifix/business';
import {
  EntityLoadRequestTag,
  type EntityRepositoryTag,
  loadUCFactory,
} from '@entifix/business';
import type {
  EntifixError,
  Entity,
  EntityLoadRequest,
  EntityPage,
} from '@entifix/core';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Context, Effect } from 'effect';

/**
 * What every read here requires: the `PublishedOffering` repository, and —
 * until the base port stops leaking it — the configuration it resolves URLs
 * through. Which transport answers is the caller's choice, made at composition.
 */
export type OfferingRead<A> = Effect.Effect<
  A,
  EntifixError,
  EntityRepositoryTag | ConfigurationRepositoryTag
>;

export interface OfferingQuery {
  /**
   * A category's **id**, as the projection stores it.
   *
   * Not its `code`: a URL carries the code, and resolving it is a read of the
   * reference vocabulary — another domain's store, so another cell. The caller
   * resolves the slug and hands the id over, and an unknown slug never reaches
   * this read at all.
   */
  readonly categoryId?: string;
  /** Free text, matched against the offering name. */
  readonly search?: string;
  readonly sort?: 'name' | 'code';
  readonly direction?: 'asc' | 'desc';
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * The cast is the one every read here needs: an `EntityLoadRequest` is
 * parameterized by the entity it filters, and a filter is a member *name*, so
 * two instantiations never overlap structurally even though the value is the
 * same.
 */
const load = (
  request: EntityLoadRequest<Entity>,
): OfferingRead<EntityPage<PublishedOffering>> =>
  loadUCFactory<PublishedOffering>().pipe(
    Effect.provide(Context.make(EntityLoadRequestTag, request)),
  ) as OfferingRead<EntityPage<PublishedOffering>>;

/** The published catalog, filtered the way the query asks. */
export const loadOfferings = (
  query: OfferingQuery = {},
): OfferingRead<EntityPage<PublishedOffering>> => {
  const filtering = [
    ...(query.categoryId !== undefined
      ? [
          {
            property: 'categoryId',
            operator: 'eq' as const,
            value: query.categoryId,
          },
        ]
      : []),
    ...(query.search
      ? [{ property: 'name', operator: 'like' as const, value: query.search }]
      : []),
  ];

  return load({
    page: query.page,
    pageSize: query.pageSize,
    sorting: query.sort
      ? ([
          { 0: { property: query.sort, type: query.direction ?? 'asc' } },
        ] as never)
      : undefined,
    filtering: filtering.length > 0 ? (filtering as never) : undefined,
  });
};

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
    filtering: [
      { property: 'offeringId', operator: 'eq', value: offeringId },
    ] as never,
    pageSize: 1,
  }).pipe(Effect.map(page => page.items[0]));
