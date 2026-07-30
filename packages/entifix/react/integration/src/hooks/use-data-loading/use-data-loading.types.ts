import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import {
  EntifixError,
  Entity,
  EntityPage,
  EntitySorting,
  FilterGroup,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

export interface UseDataLoadingState<T extends Entity> {
  isLoading: boolean;
  items: Array<T>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
  error: EntifixError | undefined;
  /**
   * The filtering and sorting currently *applied* — not a draft. The controls
   * commit through `onFilteringChange`/`onSortingChange`, so every value here
   * has already been requested from the server.
   */
  filtering: FilterGroup<T> | undefined;
  sorting: EntitySorting<T> | undefined;
}

export type UseDataLoadingAction<T extends Entity> = {
  set: Partial<UseDataLoadingState<T>>;
};

export interface UseDataLoadingOptions<TEntity extends Entity, TContext> {
  uc: Effect.Effect<
    EntityPage<TEntity>,
    EntifixError,
    EntityLoadRequestTag | TContext
  >;
  ctx: Context.Context<TContext>;
  /**
   * Page size for the first load; defaults to 10. Callers that need the whole
   * set rather than a page — a relation picker, say — raise this.
   */
  initialPageSize?: number;
  /**
   * The stable prefix that scopes this list in the shared query cache — pass
   * {@link entityQueryScope}`(Ctor)` so refetches, optimistic writes, and
   * reactive invalidation of the same entity all address one cache entry.
   * Omit it and the hook falls back to a per-instance id: correct in isolation
   * (no cross-list collisions) but unshared, so nothing outside this hook can
   * invalidate it.
   */
  queryKey?: ReadonlyArray<unknown>;
  /**
   * `false` holds the request back without unmounting the hook — what a picker's
   * browse dialog needs, since a list nobody has opened yet must not be fetched.
   * Defaults to `true`, so every existing caller loads on mount as before.
   */
  enabled?: boolean;
  /**
   * A standing restriction ANDed into every request and never shown in the filter
   * panel — "these are the rows this caller may see at all", as opposed to the
   * filter the user is editing. A link picker narrowing what may be assigned uses
   * it; so would a listing scoped to one tenant.
   */
  baseFiltering?: FilterGroup<TEntity>;
}
