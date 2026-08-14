'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { makeIndexedDbStateStorage } from './idb-state-storage';
import {
  closeTab,
  emptyTabs,
  openOrFocus,
  setActive,
  type TabRecord,
  type TabsSnapshot,
} from './tab-state';

export interface TabsState extends TabsSnapshot {
  open(tab: TabRecord): void;
  close(param: string): void;
  activate(param: string): void;
}

/** Only the data is persisted — the action functions are re-created on load. */
export function persistedTabs(store: TabsState): TabsSnapshot {
  return { tabs: store.tabs, activeParam: store.activeParam };
}

export const WORKSPACE_DB = 'r10c-workspace';
const WORKSPACE_STORE = 'stores';

/**
 * The open tab set, persisted to IndexedDB so a refresh restores the workspace.
 * Hydration is skipped on creation (it would touch IndexedDB during SSR) and
 * triggered from the client by `WorkspaceShell`, which also holds every URL
 * effect back until the read has landed — otherwise the restored `activeParam`
 * overwrites a `?tab=` deep link.
 */
export const useTabsState = create<TabsState>()(
  persist(
    set => ({
      ...emptyTabs,
      open: tab => set(state => openOrFocus(state, tab)),
      close: param => set(state => closeTab(state, param)),
      activate: param => set(state => setActive(state, param)),
    }),
    {
      name: 'tabs',
      storage: createJSONStorage(() =>
        makeIndexedDbStateStorage(WORKSPACE_DB, WORKSPACE_STORE),
      ),
      partialize: persistedTabs,
      skipHydration: true,
    },
  ),
);
