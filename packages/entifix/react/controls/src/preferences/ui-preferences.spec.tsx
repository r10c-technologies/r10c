import { EntifixConnError } from '@r10c/entifix-ts-core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiPreferencesProvider, useUiPreferencesStore } from './ui-preferences-context.js';
import type { UiPreferencesStore } from './ui-preferences-store.js';
import { useUiPreference } from './use-ui-preference.js';

/** An in-memory store that also records what was written, and can be made to fail. */
const makeRecordingStore = (
  seed: Record<string, unknown> = {},
): UiPreferencesStore & {
  written: [string, unknown][];
  failReads: boolean;
  failWrites: boolean;
} => {
  const entries = new Map(Object.entries(seed));
  const written: [string, unknown][] = [];
  const store = {
    written,
    failReads: false,
    failWrites: false,
    read: <TValue,>(key: string) =>
      store.failReads
        ? Effect.fail(new EntifixConnError('read failed'))
        : Effect.succeed(entries.get(key) as TValue | undefined),
    write: <TValue,>(key: string, value: TValue) =>
      store.failWrites
        ? Effect.fail(new EntifixConnError('write failed'))
        : Effect.sync(() => {
            written.push([key, value]);
            entries.set(key, value);
          }),
    remove: (key: string) =>
      Effect.sync(() => {
        entries.delete(key);
      }),
  } as UiPreferencesStore & {
    written: [string, unknown][];
    failReads: boolean;
    failWrites: boolean;
  };
  return store;
};

const withStore =
  (store?: UiPreferencesStore, namespace?: string) =>
  ({ children }: PropsWithChildren) => (
    <UiPreferencesProvider store={store} namespace={namespace}>
      {children}
    </UiPreferencesProvider>
  );

beforeEach(() => {
  window.localStorage.clear();
});

describe('UiPreferencesProvider', () => {
  it('publishes the store it was given', () => {
    const store = makeRecordingStore();

    const { result } = renderHook(() => useUiPreferencesStore(), {
      wrapper: withStore(store),
    });

    expect(result.current).toBe(store);
  });

  it('builds a localStorage store from the namespace when none is given', async () => {
    const { result } = renderHook(() => useUiPreferencesStore(), {
      wrapper: withStore(undefined, 'admin-ui'),
    });

    await Effect.runPromise(result.current.write('entity-table:product', 1));

    expect(window.localStorage.getItem('admin-ui:entity-table:product')).toBe('1');
  });

  it('keeps the same store across renders', () => {
    const { result, rerender } = renderHook(() => useUiPreferencesStore(), {
      wrapper: withStore(undefined, 'admin-ui'),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  // A control must stay usable in isolation — in a test, or in an app that has
  // not mounted the provider yet — so the fallback is a real store, and it is
  // module-level so its identity is stable across renders.
  it('falls back to a default store with no provider mounted', () => {
    const { result, rerender } = renderHook(() => useUiPreferencesStore());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    expect(first).toBeDefined();
  });
});

describe('useUiPreference', () => {
  it('renders the fallback until the stored value has been read', async () => {
    const { result } = renderHook(() => useUiPreference('table:product', ['id']), {
      wrapper: withStore(makeRecordingStore()),
    });

    expect(result.current.value).toEqual(['id']);
    expect(result.current.isReady).toBe(false);

    // Let the read settle so it does not resolve into a torn-down tree.
    await waitFor(() => expect(result.current.isReady).toBe(true));
  });

  it('adopts the stored value once read', async () => {
    const store = makeRecordingStore({ 'table:product': ['name'] });
    const { result } = renderHook(() => useUiPreference('table:product', ['id']), {
      wrapper: withStore(store),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.value).toEqual(['name']);
  });

  it('keeps the fallback when nothing was stored', async () => {
    const { result } = renderHook(() => useUiPreference('table:product', ['id']), {
      wrapper: withStore(makeRecordingStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.value).toEqual(['id']);
  });

  // A failed read must not leave the control stuck: it settles on the fallback
  // and reports ready, so the view renders defaults rather than nothing.
  it('settles on the fallback when the read fails', async () => {
    const store = makeRecordingStore();
    store.failReads = true;
    const { result } = renderHook(() => useUiPreference('table:product', ['id']), {
      wrapper: withStore(store),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.value).toEqual(['id']);
  });

  // Writes are optimistic: the local change applies immediately and only its
  // persistence is at risk, so a failed write is swallowed rather than thrown
  // into a render.
  it('applies a change immediately and persists it', async () => {
    const store = makeRecordingStore();
    const { result } = renderHook(() => useUiPreference('table:product', ['id']), {
      wrapper: withStore(store),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => result.current.setValue(['name']));

    expect(result.current.value).toEqual(['name']);
    await waitFor(() => expect(store.written).toEqual([['table:product', ['name']]]));
  });

  it('keeps the change when persisting it fails', async () => {
    const store = makeRecordingStore();
    store.failWrites = true;
    const { result } = renderHook(() => useUiPreference('table:product', ['id']), {
      wrapper: withStore(store),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => result.current.setValue(['name']));

    expect(result.current.value).toEqual(['name']);
    expect(result.current.isReady).toBe(true);
  });

  // Readiness is derived from which key the held value belongs to, so switching
  // key reports "not ready" for the new one instead of briefly serving the old
  // key's value as if it were the new key's.
  it('reports not-ready again when the key changes', async () => {
    const store = makeRecordingStore({
      'table:product': ['name'],
      'table:brand': ['code'],
    });
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useUiPreference(key, ['id']),
      { wrapper: withStore(store), initialProps: { key: 'table:product' } },
    );
    await waitFor(() => expect(result.current.value).toEqual(['name']));

    rerender({ key: 'table:brand' });

    await waitFor(() => expect(result.current.value).toEqual(['code']));
  });

  // Callers build `fallback` inline, so it is a fresh array every render. If the
  // read effect keyed on it, every render would re-read and clobber local edits.
  it('does not re-read when only the fallback changes identity', async () => {
    const store = makeRecordingStore();
    const { result, rerender } = renderHook(
      () => useUiPreference('table:product', ['id']),
      { wrapper: withStore(store) },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.setValue(['name']));

    rerender();
    rerender();

    expect(result.current.value).toEqual(['name']);
  });

  it('ignores a read that lands after unmount', async () => {
    const { result, unmount } = renderHook(
      () => useUiPreference('table:product', ['id']),
      { wrapper: withStore(makeRecordingStore({ 'table:product': ['name'] })) },
    );

    unmount();

    await waitFor(() => expect(result.current.value).toEqual(['id']));
  });

  it('ignores a failed read that lands after unmount', async () => {
    const store = makeRecordingStore();
    store.failReads = true;
    const { result, unmount } = renderHook(
      () => useUiPreference('table:product', ['id']),
      { wrapper: withStore(store) },
    );

    unmount();

    await waitFor(() => expect(result.current.isReady).toBe(false));
  });
});
