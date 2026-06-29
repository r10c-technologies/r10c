import { Effect, Context } from 'effect';
import { EntityLoadRequest, type Entity } from '@r10c/entifix-ts-core';
import { useCallback, useEffect, useReducer } from 'react';
import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';

import type {
  UseDataLoadingState,
  UseDataLoadingAction,
  UseDataLoadingOptions,
} from './use-data-loading.types';

function getInitialState<T>() {
  return {
    isLoading: false,
    items: [] as Array<T>,
    totalItems: 0,
    currentPage: 1,
    pageSize: 10,
  };
}

function reducer<T>(
  state: UseDataLoadingState<T>,
  action: UseDataLoadingAction<T>
): UseDataLoadingState<T> {
  return { ...state, ...action.set };
}

export function useDataLoading<TEntity extends Entity, TContext>({
  uc,
  ctx,
}: UseDataLoadingOptions<TEntity, TContext>) {
  const [state, dispatch] = useReducer(reducer, getInitialState<TEntity>());

  const composedUsedCase = useCallback(
    (loadRequest: EntityLoadRequest) => {
      const loadProductCategories = Effect.provide(
        uc,
        ctx.pipe(Context.add(EntityLoadRequestTag, loadRequest))
      );
      return Effect.runPromise(loadProductCategories);
    },
    [uc, ctx]
  );

  useEffect(() => {
    const loadRequest = {
      page: state.currentPage,
      pageSize: state.pageSize,
    };

    dispatch({ set: { isLoading: true } });

    composedUsedCase(loadRequest).then(result => {
      dispatch({ set: { items: result.items, isLoading: false } });
    });
  }, [composedUsedCase, state.currentPage, state, state.pageSize]);

  const onPageChange = useCallback((newPage: number) => {
    dispatch({ set: { currentPage: newPage } });
  }, []);

  const onPageSizeChange = useCallback((newPageSize: number) => {
    dispatch({ set: { pageSize: newPageSize, currentPage: 1 } });
  }, []);

  return {
    ...state,
    onPageChange,
    onPageSizeChange,
  };
}
