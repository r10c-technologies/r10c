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
 * Bump when {@link TabsSnapshot}'s shape changes, and every persisted tab set is
 * discarded on the next load.
 *
 * Restoring a snapshot this build cannot read is worse than opening empty: a tab
 * whose `param` no longer resolves renders the workspace's dead-link fallback,
 * so a drifted snapshot is a strip of broken tabs rather than an error anyone
 * can act on.
 */
export const TABS_VERSION = 1;

/**
 * Discard, never guess — see {@link migrateDrafts} for the same decision on the
 * other store, and for why this is written out instead of left to zustand's
 * default (which discards too, but logs an error while doing it).
 */
export function migrateTabs(): TabsSnapshot {
  return emptyTabs;
}

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
      // Replaced with a scoped name by `WorkspaceShell` before it rehydrates —
      // see `workspace-scope.ts`. Nothing rehydrates without passing through
      // that call, so this literal is only what an unscoped store would write.
      name: 'tabs',
      version: TABS_VERSION,
      migrate: migrateTabs,
      storage: createJSONStorage(() =>
        makeIndexedDbStateStorage(WORKSPACE_DB, WORKSPACE_STORE),
      ),
      partialize: persistedTabs,
      skipHydration: true,
    },
  ),
);
