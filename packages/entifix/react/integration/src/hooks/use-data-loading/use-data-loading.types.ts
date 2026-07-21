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
}
