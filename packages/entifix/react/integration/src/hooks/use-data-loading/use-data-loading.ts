import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import {
  type EntifixError,
  type Entity,
  type EntityLoadRequest,
  type EntityPage,
  type EntitySorting,
  type FilterGroup,
  serializeRsql,
  serializeSort,
} from '@r10c/entifix-ts-core';
import { useQuery } from '@tanstack/react-query';
import { Context, Effect } from 'effect';
import { useCallback, useEffect, useId, useMemo, useReducer, useRef } from 'react';

import type { UseDataLoadingOptions } from './use-data-loading.types';

const DEFAULT_PAGE_SIZE = 10;

/**
 * The request the caller controls — page, size, and the *applied* filter/sort.
 * The response (items, loading, error) is owned by the query cache, not here.
 */
interface RequestState<T extends Entity> {
  currentPage: number;
  pageSize: number;
  filtering: FilterGroup<T> | undefined;
  sorting: EntitySorting<T> | undefined;
}

type RequestAction<T extends Entity> = { set: Partial<RequestState<T>> };

function requestReducer<T extends Entity>(
  state: RequestState<T>,
  action: RequestAction<T>,
): RequestState<T> {
  return { ...state, ...action.set };
}

function initialRequest<T extends Entity>(pageSize: number): RequestState<T> {
  return {
    currentPage: 1,
    pageSize,
    filtering: undefined,
    sorting: undefined,
  };
}

/**
 * Runs an entity list use-case and caches the result through TanStack Query.
 *
 * The reducer owns the *request* (page/size/filter/sort); `useQuery` owns the
 * *fetch* — deduping, caching, and (with a shared `queryKey`) letting mutations
 * and reactive events invalidate the list. The public shape is unchanged: the
 * `uc`/`ctx` come in the same way and the Effect runs against the same provided
 * Tags, so callers and organisms are untouched.
 */
export function useDataLoading<TEntity extends Entity, TContext>({
  uc,
  ctx,
  initialPageSize = DEFAULT_PAGE_SIZE,
  queryKey,
}: UseDataLoadingOptions<TEntity, TContext>) {
  const [request, dispatch] = useReducer(
    requestReducer as (
      state: RequestState<TEntity>,
      action: RequestAction<TEntity>,
    ) => RequestState<TEntity>,
    initialPageSize,
    initialRequest<TEntity>,
  );

  // Callers rebuild `uc`/`ctx` inline every render, so hold the latest in refs
  // and keep them out of the query key — keying on their identity would refetch
  // on every render. Written in an effect (refs may not be set during render);
  // effects fire in order, so the query below always reads the latest.
  const ucRef = useRef(uc);
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ucRef.current = uc;
    ctxRef.current = ctx;
  });

  // The applied filter/sort are rebuilt each render, so their *serialized* form
  // — the same codec the request needs anyway — is what keys the query: a stable
  // string that changes exactly when the query does.
  const rsql = useMemo(
    () => serializeRsql(request.filtering ? [request.filtering] : undefined),
    [request.filtering],
  );
  const sort = useMemo(
    () => serializeSort(request.sorting ? [request.sorting] : undefined),
    [request.sorting],
  );

  const loadRequest = useMemo<EntityLoadRequest<TEntity>>(() => {
    const built: EntityLoadRequest<TEntity> = {
      page: request.currentPage,
      pageSize: request.pageSize,
    };
    // An empty group serializes to nothing; omit it rather than send a filter
    // that matches everything.
    if (rsql !== '' && request.filtering) {
      built.filtering = [request.filtering];
    }
    if (sort !== '' && request.sorting) {
      built.sorting = [request.sorting];
    }
    return built;
  }, [request.currentPage, request.pageSize, request.filtering, request.sorting, rsql, sort]);

  // Falls back to a per-instance id so an un-scoped list never collides with
  // another in the shared cache — correct, just unshared (see the type doc).
  const instanceId = useId();
  const scope = queryKey ?? [instanceId];

  const query = useQuery<EntityPage<TEntity>, EntifixError>({
    queryKey: [
      ...scope,
      'load',
      request.currentPage,
      request.pageSize,
      rsql,
      sort,
    ],
    queryFn: () =>
      Effect.runPromise(
        Effect.provide(
          ucRef.current,
          ctxRef.current.pipe(
            Context.add(
              EntityLoadRequestTag,
              // The tag carries no generic, so the entity-typed request crosses
              // it — the same cast `loadUCFactory` makes reading it back.
              loadRequest as unknown as EntityLoadRequest,
            ),
          ),
        ),
      ),
  });

  const onPageChange = useCallback((newPage: number) => {
    dispatch({ set: { currentPage: newPage } });
  }, []);

  const onPageSizeChange = useCallback((newPageSize: number) => {
    dispatch({ set: { pageSize: newPageSize, currentPage: 1 } });
  }, []);

  // Narrowing the result set invalidates the page number: page 4 of the old
  // result is very likely past the end of the new one.
  const onFilteringChange = useCallback((filtering: FilterGroup<TEntity>) => {
    dispatch({ set: { filtering, currentPage: 1 } });
  }, []);

  const onSortingChange = useCallback((sorting: EntitySorting<TEntity>) => {
    dispatch({ set: { sorting, currentPage: 1 } });
  }, []);

  return {
    isLoading: query.isFetching,
    items: query.data?.items ?? ([] as Array<TEntity>),
    totalItems: query.data?.total ?? 0,
    currentPage: request.currentPage,
    pageSize: request.pageSize,
    error: query.error ?? undefined,
    filtering: request.filtering,
    sorting: request.sorting,
    onPageChange,
    onPageSizeChange,
    onFilteringChange,
    onSortingChange,
  };
}
