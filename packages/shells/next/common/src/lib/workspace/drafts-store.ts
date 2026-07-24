'use client';

import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { makeIndexedDbStateStorage } from './idb-state-storage';
import { WORKSPACE_DB } from './tabs-store';

/**
 * Per-address edit drafts, persisted to IndexedDB so an in-progress edit
 * survives a refresh. Keyed by the tab's `?tab=` param (its address), a draft is
 * whatever the editor needs to restore its fields; it exists until the user
 * saves (or discards). This is the "continuous autosave" seam — workspace-host
 * only, so a plain route stays ephemeral.
 */
export interface DraftsStore {
  drafts: Record<string, unknown>;
  setDraft(address: string, value: unknown): void;
  clearDraft(address: string): void;
}

export function persistedDrafts(store: DraftsStore): Pick<DraftsStore, 'drafts'> {
  return { drafts: store.drafts };
}

const DRAFTS_STORE = 'stores';

export const useDraftsStore = create<DraftsStore>()(
  persist(
    set => ({
      drafts: {},
      setDraft: (address, value) =>
        set(state => ({ drafts: { ...state.drafts, [address]: value } })),
      clearDraft: address =>
        set(state => {
          if (!(address in state.drafts)) return state;
          const { [address]: _removed, ...rest } = state.drafts;
          return { drafts: rest };
        }),
    }),
    {
      name: 'drafts',
      storage: createJSONStorage(() =>
        makeIndexedDbStateStorage(WORKSPACE_DB, DRAFTS_STORE),
      ),
      partialize: persistedDrafts,
      skipHydration: true,
    },
  ),
);

/** Whether an address currently has an unsaved draft. */
export function selectIsDirty(address: string) {
  return (state: DraftsStore): boolean => address in state.drafts;
}

/**
 * Bind an editor to its persisted draft. Returns the current draft (restored
 * from IndexedDB on mount), a setter the editor calls as fields change, and a
 * clear for when the edit is committed.
 */
export function useDraft<TDraft>(address: string) {
  const draft = useDraftsStore(
    state => state.drafts[address] as TDraft | undefined,
  );
  const set = useDraftsStore(state => state.setDraft);
  const clear = useDraftsStore(state => state.clearDraft);

  useEffect(() => {
    void useDraftsStore.persist.rehydrate();
  }, []);

  const setDraft = useCallback(
    (value: TDraft) => set(address, value),
    [set, address],
  );
  const clearDraft = useCallback(() => clear(address), [clear, address]);

  return { draft, setDraft, clearDraft };
}
