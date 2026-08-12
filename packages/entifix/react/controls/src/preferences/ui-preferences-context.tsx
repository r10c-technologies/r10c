'use client';

import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';

import {
  DEFAULT_UI_PREFERENCES_NAMESPACE,
  makeLocalStorageUiPreferencesState,
} from './local-storage-ui-preferences-state';
import type { UiPreferencesState } from './ui-preferences-state';

const UiPreferencesContext = createContext<UiPreferencesState | null>(null);

export interface UiPreferencesProviderProps extends PropsWithChildren {
  /** Explicit store. Omit and a `localStorage` one is built from `namespace`. */
  store?: UiPreferencesState;
  /** Key prefix, so apps sharing an origin don't clobber each other. */
  namespace?: string;
}

/**
 * Supplies the {@link UiPreferencesState} every personalizable control reads
 * through. Mount it once per app, at the root: swapping the implementation here
 * (say, for a server-backed store) migrates every control at once.
 */
export function UiPreferencesProvider({
  children,
  store,
  namespace = DEFAULT_UI_PREFERENCES_NAMESPACE,
}: UiPreferencesProviderProps) {
  const value = useMemo(
    () => store ?? makeLocalStorageUiPreferencesState(namespace),
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
const fallbackStore = makeLocalStorageUiPreferencesState();

export function useUiPreferencesState(): UiPreferencesState {
  return useContext(UiPreferencesContext) ?? fallbackStore;
}
