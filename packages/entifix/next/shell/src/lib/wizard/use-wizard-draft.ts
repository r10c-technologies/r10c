'use client';

import type { WizardDraftStore } from '@r10c/entifix-react-integration';
import { readWizardState, type WizardState } from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

import { useDraft } from '../workspace/drafts-state';

/**
 * The workspace's implementation of `useWizard`'s draft port: binds a wizard to
 * the address-keyed state this workspace persists to IndexedDB.
 *
 * The sibling of `useEntityDraft`, and deliberately a second hook rather than a
 * widening of it: the two persist different shapes — one an `EntityDraft`, this
 * a whole `WizardState` — so one hook serving both would let a form be handed a
 * wizard's state by a caller that mixed up the addresses.
 *
 * ⚠️ What comes back from storage is **narrowed**, not trusted. A stored wizard
 * can be anything a previous build wrote, and a step whose shape no longer
 * parses is answered with a fresh wizard rather than a crash — `readWizardState`
 * makes that call, and it fails the whole state rather than dropping one step,
 * because resuming with one page silently forgotten is worse than starting over.
 *
 * The returned object is memoised because the port requires a stable `save`: the
 * hook writes from a handler keyed on it, so a fresh identity each render would
 * turn every render into an IndexedDB write.
 */
export function useWizardDraft(address: string): WizardDraftStore {
  const { draft, setDraft, clearDraft } = useDraft<WizardState>(address);

  const state = useMemo(() => readWizardState(draft), [draft]);

  return useMemo(
    () => ({ state, save: setDraft, clear: clearDraft }),
    [state, setDraft, clearDraft],
  );
}
