import type { Entity, EntityPage } from '@r10c/entifix-ts-core';

/**
 * Puts a record that has not been written yet at the top of a cached page.
 *
 * Pure and separate from `makeEntityCrud` because `setQueriesData` hands the
 * updater `undefined` for a query that is in the cache but has not resolved yet
 * — a real state (the list is still loading when a save lands) that is awkward
 * to arrange through a render, and trivial to state here.
 *
 * `total` moves with `items` so the pager does not disagree with what is on
 * screen. Both are replaced by server truth on the next invalidation, so this
 * only has to be right for the seconds in between.
 */
export const prependOptimistic =
  <TEntity extends Entity>(saved: TEntity) =>
  (page: EntityPage<TEntity> | undefined): EntityPage<TEntity> | undefined =>
    page === undefined
      ? page
      : { ...page, items: [saved, ...page.items], total: page.total + 1 };
