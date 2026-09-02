'use client';

import { isJsonValue, type JsonValue } from '@r10c/entifix-ts-core';
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { makeIndexedDbStateStorage } from './idb-state-storage';
import { WORKSPACE_DB } from './tabs-state';

/**
 * Per-address edit drafts, persisted to IndexedDB so an in-progress edit
 * survives a refresh. Keyed by the tab's `?tab=` param (its address), a draft is
 * whatever the editor needs to restore its fields; it exists until the user
 * saves (or discards). This is the "continuous autosave" seam — workspace-host
 * only, so a plain route stays ephemeral.
 *
 * **A draft is JSON round-trippable, period.** It is written through
 * `createJSONStorage`, so a class instance, an `EntityLink` or a `Date` does not
 * "mostly survive" — it comes back as something else, silently. {@link JsonValue}
 * is the compile-time half of that rule and {@link mergeDrafts} the runtime half.
 * Note that `UiPreferencesState`, the other persisted client store, writes
 * through IndexedDB's structured clone and *does* keep a `Date`; the two
 * contracts differ and must not be conflated.
 */
export interface DraftsState {
  drafts: Record<string, JsonValue>;
  setDraft(address: string, value: JsonValue): void;
  clearDraft(address: string): void;
}

export function persistedDrafts(
  store: DraftsState,
): Pick<DraftsState, 'drafts'> {
  return { drafts: store.drafts };
}

const DRAFTS_STORE = 'stores';

/**
 * Bump when the *envelope* changes — how a draft is keyed or wrapped — and every
 * persisted draft is discarded on the next load.
 *
 * It cannot see a change to one entity's members, because a draft is opaque
 * here: this store holds `JsonValue`, and only the form that wrote one knows
 * which members it should have. That half is `restoreEntityDraft`, which layers
 * a restored draft over a freshly seeded one so a drifted member is dropped or
 * re-seeded rather than rendered.
 */
export const DRAFTS_VERSION = 1;

const emptyDrafts: Pick<DraftsState, 'drafts'> = { drafts: {} };

/**
 * Discard, never guess. A draft whose envelope this build does not understand is
 * an unfinished edit, not a record — losing it costs a retype, while migrating
 * it blind risks submitting values whose meaning has changed.
 *
 * Written out rather than left to zustand's default, which discards too but logs
 * `State loaded from storage couldn't be migrated since no migrate function was
 * provided` while doing it — an error message for a decision that was made on
 * purpose.
 */
export function migrateDrafts(): Pick<DraftsState, 'drafts'> {
  return emptyDrafts;
}

/**
 * Restores only the entries that are actually JSON.
 *
 * The type above says what may be written; this is what happens when something
 * else was, by a build that predates the rule or by a `setDraft` reached through
 * a cast. Dropping the offending entry keeps one bad draft from taking the whole
 * workspace's drafts with it — and it is per entry rather than all-or-nothing
 * for that reason.
 */
export function mergeDrafts(
  persistedState: unknown,
  currentState: DraftsState,
): DraftsState {
  const restored = (persistedState as Partial<DraftsState> | undefined)?.drafts;
  if (restored === null || typeof restored !== 'object') return currentState;

  const drafts: Record<string, JsonValue> = {};
  for (const [address, value] of Object.entries(restored)) {
    if (isJsonValue(value)) drafts[address] = value;
  }
  return { ...currentState, drafts };
}

export const useDraftsState = create<DraftsState>()(
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
      // Replaced with a scoped name by `WorkspaceShell` before it rehydrates, so
      // two accounts on one browser profile do not share drafts. This literal is
      // only what an unscoped store would write, and nothing rehydrates without
      // passing through that call.
      name: 'drafts',
      version: DRAFTS_VERSION,
      migrate: migrateDrafts,
      merge: mergeDrafts,
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
  return (state: DraftsState): boolean => address in state.drafts;
}

/**
 * Bind an editor to its persisted draft. Returns the current draft (restored
 * from IndexedDB on mount), a setter the editor calls as fields change, and a
 * clear for when the edit is committed.
 *
 * `TDraft` is constrained to {@link JsonValue}: an editor that wants to autosave
 * something a JSON round trip would not return is asking for the one thing this
 * store cannot do, and the compile error is the whole point of the constraint.
 *
 * One sharp edge, and the error message does not explain it: **declare a draft
 * type as a `type`, never an `interface`.** TypeScript gives an interface no
 * implicit index signature, so even `interface Draft { name: string }` — as JSON
 * as a value gets — fails the constraint with "Index signature for type 'string'
 * is missing". A `type` alias of the same shape passes.
 */
export function useDraft<TDraft extends JsonValue>(address: string) {
  const draft = useDraftsState(
    state => state.drafts[address] as TDraft | undefined,
  );
  const set = useDraftsState(state => state.setDraft);
  const clear = useDraftsState(state => state.clearDraft);

  useEffect(() => {
    void useDraftsState.persist.rehydrate();
  }, []);

  const setDraft = useCallback(
    (value: TDraft) => set(address, value),
    [set, address],
  );
  const clearDraft = useCallback(() => clear(address), [clear, address]);

  return { draft, setDraft, clearDraft };
}
