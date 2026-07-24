import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import {
  EntifixConnError,
  type Entity,
  type EntityLoadRequest,
  type FilterGroup,
} from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { EntifixQueryProvider } from '../../query/query-provider.js';
import { useDataLoading } from './use-data-loading.js';

/** A fresh QueryClient per render keeps each test's cache isolated. */
const wrapper = ({ children }: { children: ReactNode }) => (
  <EntifixQueryProvider>{children}</EntifixQueryProvider>
);

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
  renderHook(
    () =>
      useDataLoading<Widget, ConfigurationRepositoryTag | EntityRepositoryTag>({
        uc: loadUCFactory<Widget>(),
        ctx: makeContext(),
        ...(initialPageSize === undefined ? {} : { initialPageSize }),
      }),
    { wrapper },
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

/**
 * Filtering and sorting reach the repository through the same load request as
 * paging, so these run the real UC over the in-memory double and assert on what
 * came back rather than on the request object.
 */
describe('useDataLoading filtering and sorting', () => {
  /** Records every load request the hook issued. */
  const recording = () => {
    const requests: Array<EntityLoadRequest<Widget>> = [];
    const inner = repository;
    const spy: typeof repository = {
      ...inner,
      load: (<T extends Entity>(request: EntityLoadRequest<T>) => {
        requests.push(request as unknown as EntityLoadRequest<Widget>);
        return inner.load<T>(request);
      }) as typeof inner.load,
    };
    repository = spy;
    return requests;
  };

  const filterByName = (value: string): FilterGroup<Widget> => ({
    operator: 'and',
    values: [{ property: 'name', operator: 'eq', value }],
  });

  it('narrows the result set once filtering is applied', async () => {
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onFilteringChange(filterByName('Widget 7')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.totalItems).toBe(1);
    expect(result.current.filtering).toEqual(filterByName('Widget 7'));
  });

  it('orders the result set once sorting is applied', async () => {
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() =>
      result.current.onSortingChange({ 0: { property: 'name', type: 'desc' } }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items[0]?.name).toBe('Widget 9');
    expect(result.current.sorting).toEqual({
      0: { property: 'name', type: 'desc' },
    });
  });

  // Page 3 of the old result is very likely past the end of the narrowed one,
  // which would strand the user on an empty page.
  it.each([
    [
      'filtering',
      (hook: ReturnType<typeof renderLoading>['result']['current']) =>
        hook.onFilteringChange(filterByName('Widget 7')),
    ],
    [
      'sorting',
      (hook: ReturnType<typeof renderLoading>['result']['current']) =>
        hook.onSortingChange({ 0: { property: 'name', type: 'desc' } }),
    ],
  ])('returns to page 1 when %s changes', async (_label, change) => {
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.onPageChange(3));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => change(result.current));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentPage).toBe(1);
  });

  it('sends the applied filtering and sorting in the load request', async () => {
    const requests = recording();
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onFilteringChange(filterByName('Widget 7')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() =>
      result.current.onSortingChange({ 0: { property: 'name', type: 'asc' } }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(requests.at(-1)).toEqual({
      page: 1,
      pageSize: 10,
      filtering: [filterByName('Widget 7')],
      sorting: [{ 0: { property: 'name', type: 'asc' } }],
    });
  });

  // An empty group matches everything, so sending it would be noise on the
  // wire — and it is exactly what Clear produces. Clearing returns to the plain
  // first page, which is still cached from mount, so nothing new hits the wire
  // and — crucially — no match-all filter is ever sent.
  it('omits an emptied filtering rather than sending a match-all', async () => {
    const requests = recording();
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.onFilteringChange(filterByName('Widget 7')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() =>
      result.current.onFilteringChange({ operator: 'and', values: [] }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(
      requests.some(request => {
        const group = request.filtering?.[0];
        return group !== undefined && 'values' in group && group.values.length === 0;
      }),
    ).toBe(false);
    expect(result.current.items).toHaveLength(10);
  });

  it('omits an emptied sorting', async () => {
    const requests = recording();
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() =>
      result.current.onSortingChange({ 0: { property: 'name', type: 'desc' } }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onSortingChange({}));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(
      requests.some(
        request =>
          request.sorting !== undefined &&
          Object.keys(request.sorting[0]).length === 0,
      ),
    ).toBe(false);
    expect(result.current.items).toHaveLength(10);
  });

  // The fetch effect keys on the *serialized* query, not on object identity.
  // Re-applying an equal filter must therefore not put another request on the
  // wire — keying on identity here would refetch on every render forever.
  it('does not refetch when an equal filtering is re-applied', async () => {
    const requests = recording();
    const { result } = renderLoading();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.onFilteringChange(filterByName('Widget 7')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = requests.length;

    // A new object with the same content, as a caller would rebuild it.
    act(() => result.current.onFilteringChange(filterByName('Widget 7')));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(requests).toHaveLength(before);
  });
});
