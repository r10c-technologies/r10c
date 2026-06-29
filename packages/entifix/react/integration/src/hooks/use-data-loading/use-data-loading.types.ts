import { Context, Effect } from 'effect';
import { Entity, EntityPage, EntifixError } from '@r10c/entifix-ts-core';
import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';

export interface UseDataLoadingState<T> {
  isLoading: boolean;
  items: Array<T>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
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
}
