'use client';

import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';

import {
  DEFAULT_UI_PREFERENCES_NAMESPACE,
  makeLocalStorageUiPreferencesStore,
} from './local-storage-ui-preferences-store';
import type { UiPreferencesStore } from './ui-preferences-store';

const UiPreferencesContext = createContext<UiPreferencesStore | null>(null);

export interface UiPreferencesProviderProps extends PropsWithChildren {
  /** Explicit store. Omit and a `localStorage` one is built from `namespace`. */
  store?: UiPreferencesStore;
  /** Key prefix, so apps sharing an origin don't clobber each other. */
  namespace?: string;
}

/**
 * Supplies the {@link UiPreferencesStore} every personalizable control reads
 * through. Mount it once per app, at the root: swapping the implementation here
 * (say, for a server-backed store) migrates every control at once.
 */
export function UiPreferencesProvider({
  children,
  store,
  namespace = DEFAULT_UI_PREFERENCES_NAMESPACE,
}: UiPreferencesProviderProps) {
  const value = useMemo(
    () => store ?? makeLocalStorageUiPreferencesStore(namespace),
    [store, namespace],
  );

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

/**
 * The active store. Falls back to a default `localStorage` store when no
 * provider is mounted, so a control stays usable in isolation (tests, an app
 * that has not opted in yet) — the fallback is module-level so its identity is
 * stable across renders.
 */
const fallbackStore = makeLocalStorageUiPreferencesStore();

export function useUiPreferencesStore(): UiPreferencesStore {
  return useContext(UiPreferencesContext) ?? fallbackStore;
}
