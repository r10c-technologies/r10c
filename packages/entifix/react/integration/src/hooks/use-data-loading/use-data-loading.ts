import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import { EntifixError, type Entity } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type {
  UseDataLoadingAction,
  UseDataLoadingOptions,
  UseDataLoadingState,
} from './use-data-loading.types';

const DEFAULT_PAGE_SIZE = 10;

function getInitialState<T>(pageSize: number): UseDataLoadingState<T> {
  return {
    isLoading: false,
    items: [] as Array<T>,
    totalItems: 0,
    currentPage: 1,
    pageSize,
    error: undefined,
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
  initialPageSize = DEFAULT_PAGE_SIZE,
}: UseDataLoadingOptions<TEntity, TContext>) {
  const [state, dispatch] = useReducer(
    reducer as (
      state: UseDataLoadingState<TEntity>,
      action: UseDataLoadingAction<TEntity>
    ) => UseDataLoadingState<TEntity>,
    getInitialState<TEntity>(initialPageSize)
  );

  // Callers build `uc`/`ctx` inline, so they are fresh objects on every render.
  // Holding the latest in refs keeps them out of the fetch effect's
  // dependencies: keying the fetch on their identity would re-run it on every
  // render, and its dispatch would render again — an unbreakable loop that
  // refetches until the browser runs out of sockets.
  const ucRef = useRef(uc);
  const ctxRef = useRef(ctx);

  // Refs may not be written during render; this runs before the fetch effect
  // below (effects fire in declaration order), so it always sees the latest.
  useEffect(() => {
    ucRef.current = uc;
    ctxRef.current = ctx;
  });

  useEffect(() => {
    const loadRequest = {
      page: state.currentPage,
      pageSize: state.pageSize,
    };

    // Guards against a slow response for an earlier page landing after a newer one.
    let active = true;
    dispatch({ set: { isLoading: true, error: undefined } });

    Effect.runPromise(
      Effect.provide(
        ucRef.current,
        ctxRef.current.pipe(Context.add(EntityLoadRequestTag, loadRequest))
      )
    )
      .then(result => {
        if (active) {
          dispatch({
            set: {
              items: result.items,
              totalItems: result.total,
              isLoading: false,
            },
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          dispatch({ set: { error: error as EntifixError, isLoading: false } });
        }
      });

    return () => {
      active = false;
    };
  }, [state.currentPage, state.pageSize]);

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
