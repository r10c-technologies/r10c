import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import { EntifixConnError, type Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDataLoading } from './use-data-loading.js';

interface Widget extends Entity {
  name: string;
}

const widgets = (count: number): Widget[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `w-${index + 1}`,
    name: `Widget ${index + 1}`,
  }));

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const makeContext = () =>
  Context.make(EntityRepositoryTag, repository).pipe(
    Context.add(ConfigurationRepositoryTag, makeStubConfigurationStore()),
  );

/** The whole stack a page runs: the real UC over the in-memory repository. */
const renderLoading = (initialPageSize?: number) =>
  renderHook(() =>
    useDataLoading<Widget, ConfigurationRepositoryTag | EntityRepositoryTag>({
      uc: loadUCFactory<Widget>(),
      ctx: makeContext(),
      ...(initialPageSize === undefined ? {} : { initialPageSize }),
    }),
  );

beforeEach(() => {
  repository = makeInMemoryEntityRepository(widgets(25));
});

describe('useDataLoading', () => {
  it('loads the first page on mount', async () => {
    const { result } = renderLoading();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(10);
    expect(result.current.totalItems).toBe(25);
    expect(result.current.error).toBeUndefined();
  });

  it('starts on page 1 with the default page size', async () => {
    const { result } = renderLoading();

    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageSize).toBe(10);

    // Let the mount load settle so it does not dispatch into a torn-down tree.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('honours an explicit initial page size', async () => {
    const { result } = renderLoading(5);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pageSize).toBe(5);
    expect(result.current.items).toHaveLength(5);
  });

  it('reports loading while the request is in flight', async () => {
    const { result } = renderLoading();

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('fetches the requested page on a page change', async () => {
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onPageChange(3));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentPage).toBe(3);
    expect(result.current.items[0]?.id).toBe('w-21');
  });

  // Changing page size while deep in a listing would otherwise land on a page
  // that no longer exists, so it resets to the first page.
  it('returns to page 1 when the page size changes', async () => {
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.onPageChange(3));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onPageSizeChange(5));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageSize).toBe(5);
    expect(result.current.items).toHaveLength(5);
  });

  it('surfaces a failure and stops loading', async () => {
    repository.failNext(new EntifixConnError('unreachable'));
    const { result } = renderLoading();

    await waitFor(() => expect(result.current.error).toBeDefined());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('clears a previous failure when the next load starts', async () => {
    repository.failNext(new EntifixConnError('unreachable'));
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.error).toBeDefined());

    act(() => result.current.onPageChange(2));

    await waitFor(() => expect(result.current.error).toBeUndefined());
  });

  // `uc`/`ctx` are rebuilt inline by callers on every render. If the fetch
  // effect keyed on their identity it would refetch forever; this is the test
  // that would catch a regression there.
  it('does not refetch when only the caller’s objects change identity', async () => {
    const { result, rerender } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = repository.items.length;

    rerender();
    rerender();

    expect(result.current.isLoading).toBe(false);
    expect(repository.items.length).toBe(before);
  });

  // Both settlement paths are guarded, so neither a page nor an error can be
  // dispatched into an unmounted tree.
  it('ignores a response that lands after unmount', async () => {
    const { result, unmount } = renderLoading();

    unmount();

    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  it('ignores a failure that lands after unmount', async () => {
    repository.failNext(new EntifixConnError('unreachable'));
    const { result, unmount } = renderLoading();

    unmount();

    await waitFor(() => expect(result.current.error).toBeUndefined());
  });
});
