'use client';

import type { EntityDraftStore } from '@r10c/entifix-react-integration';
import type { EntityDraft } from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

import { useDraft } from './drafts-state';

/**
 * The workspace's implementation of `useEntityForm`'s draft port: binds a form
 * to the address-keyed draft this workspace persists to IndexedDB.
 *
 * The address is the tab's own `?tab=` value, which is what makes a tab's dirty
 * marker and its close confirmation fall out of the same fact the form is
 * autosaving into — `WorkspaceShell` reads `drafts` directly and asks nothing
 * else.
 *
 * Handing this to a form is the *whole* opt-in. A plain route hands nothing and
 * stays ephemeral, by construction rather than by a flag: there is no value of
 * a missing prop that accidentally starts persisting.
 *
 * The returned object is memoised because the port requires a stable `save`:
 * the hook writes from an effect keyed on it, so a fresh identity each render
 * would turn every render into an IndexedDB write.
 *
 * `'use client'` is load-bearing here, not decoration. This module is reached
 * through the package's flat client entry, and per-file swc keeps each file's
 * own directive — a module with hooks and no directive is what drags `useMemo`
 * into a Server Component's build.
 */
export function useEntityDraft(address: string): EntityDraftStore {
  const { draft, setDraft, clearDraft } = useDraft<EntityDraft>(address);

  return useMemo(
    () => ({ draft, save: setDraft, clear: clearDraft }),
    [draft, setDraft, clearDraft],
  );
}
