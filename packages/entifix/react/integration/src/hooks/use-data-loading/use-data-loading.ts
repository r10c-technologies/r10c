import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import {
  EntifixError,
  type Entity,
  type EntityLoadRequest,
  type EntitySorting,
  type FilterGroup,
  serializeRsql,
  serializeSort,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type {
  UseDataLoadingAction,
  UseDataLoadingOptions,
  UseDataLoadingState,
} from './use-data-loading.types';

const DEFAULT_PAGE_SIZE = 10;

function getInitialState<T extends Entity>(
  pageSize: number,
): UseDataLoadingState<T> {
  return {
    isLoading: false,
    items: [] as Array<T>,
    totalItems: 0,
    currentPage: 1,
    pageSize,
    error: undefined,
    filtering: undefined,
    sorting: undefined,
  };
}

function reducer<T extends Entity>(
  state: UseDataLoadingState<T>,
  action: UseDataLoadingAction<T>,
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
      action: UseDataLoadingAction<TEntity>,
    ) => UseDataLoadingState<TEntity>,
    getInitialState<TEntity>(initialPageSize),
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

  // The applied filtering/sorting are objects rebuilt by the caller on every
  // render, so their identity cannot key the fetch effect (see the refs above —
  // same failure, an unbreakable refetch loop). Their *serialized* form is a
  // stable string that changes exactly when the query does, so the codec that
  // already has to run for the request doubles as the change detector.
  const rsql = useMemo(
    () => serializeRsql(state.filtering ? [state.filtering] : undefined),
    [state.filtering],
  );
  const sort = useMemo(
    () => serializeSort(state.sorting ? [state.sorting] : undefined),
    [state.sorting],
  );

  useEffect(() => {
    const loadRequest: EntityLoadRequest<TEntity> = {
      page: state.currentPage,
      pageSize: state.pageSize,
    };
    // The typed values are read straight from state rather than through refs:
    // unlike `uc`/`ctx` they are not rebuilt by the caller, and the effect only
    // re-runs when their serialized form changed — so a closure kept across a
    // no-op change holds an object of identical content.
    //
    // An empty group serializes to nothing; omit it rather than send a filter
    // that matches everything.
    if (rsql !== '' && state.filtering) {
      loadRequest.filtering = [state.filtering];
    }
    if (sort !== '' && state.sorting) {
      loadRequest.sorting = [state.sorting];
    }

    // Guards against a slow response for an earlier page landing after a newer one.
    let active = true;
    dispatch({ set: { isLoading: true, error: undefined } });

    Effect.runPromise(
      Effect.provide(
        ucRef.current,
        ctxRef.current.pipe(
          Context.add(
            EntityLoadRequestTag,
            // The tag deliberately carries no generic, so the entity-typed
            // request is cast across it — the same crossing `loadUCFactory`
            // makes in the opposite direction when it reads the tag back.
            loadRequest as unknown as EntityLoadRequest,
          ),
        ),
      ),
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
    // `state.filtering`/`state.sorting` are deliberately absent: `rsql`/`sort`
    // are derived from them and change exactly when the query does, whereas the
    // objects themselves change identity on every caller render — keying on
    // those would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentPage, state.pageSize, rsql, sort]);

  const onPageChange = useCallback((newPage: number) => {
    dispatch({ set: { currentPage: newPage } });
  }, []);

  const onPageSizeChange = useCallback((newPageSize: number) => {
    dispatch({ set: { pageSize: newPageSize, currentPage: 1 } });
  }, []);

  // Narrowing the result set invalidates the page number: page 4 of the old
  // result is very likely past the end of the new one, which would leave the
  // user on an empty page.
  const onFilteringChange = useCallback((filtering: FilterGroup<TEntity>) => {
    dispatch({ set: { filtering, currentPage: 1 } });
  }, []);

  const onSortingChange = useCallback((sorting: EntitySorting<TEntity>) => {
    dispatch({ set: { sorting, currentPage: 1 } });
  }, []);

  return {
    ...state,
    onPageChange,
    onPageSizeChange,
    onFilteringChange,
    onSortingChange,
  };
}
