import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import { EntifixError, Entity, EntityPage } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

export interface UseDataLoadingState<T> {
  isLoading: boolean;
  items: Array<T>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
  error: EntifixError | undefined;
}

export type UseDataLoadingAction<T> = {
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
