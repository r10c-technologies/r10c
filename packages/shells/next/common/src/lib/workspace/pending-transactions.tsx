'use client';

import type {
  PendingEntry,
  PendingTransactionStore,
} from '@r10c/entifix-transactions';
import { NoopTransactionSink } from '@r10c/entifix-transactions';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from 'react';

import { usePendingState } from './pending-state';

/**
 * What a caller outside a mounted provider gets: a store that watches nothing.
 *
 * A create on a page with no provider still works exactly as it does today — it
 * simply gets no optimistic treatment. That is the honest boundary, and it is
 * what keeps `began` from ever writing into an unscoped store.
 */
const noopStore: PendingTransactionStore = {
  ...NoopTransactionSink,
  entries: [],
  attach: () => false,
  settle: () => undefined,
  fail: () => undefined,
  dismiss: () => undefined,
};

const PendingTransactionsContext =
  createContext<PendingTransactionStore>(noopStore);

/**
 * Which scope the module-level store has already been read for.
 *
 * Module-level because the store it guards is: `usePendingState` is a singleton,
 * so "has this been hydrated" is a fact about the module and not about any one
 * component instance. A ref would reset on remount, which is the case this
 * exists to survive.
 */
let hydratedScope: string | undefined;

/** Test seam: forget that any scope was hydrated. */
export function resetPendingHydration(): void {
  hydratedScope = undefined;
}

export interface PendingTransactionsProviderProps {
  /**
   * Who these pending writes belong to — the same `workspaceScopeKey({ userId,
   * organizationId })` the workspace is scoped with.
   *
   * Required for the reason `WorkspaceShellProps.scope` is: IndexedDB is a
   * property of the browser profile, so a host that forgets one hands the next
   * account to sign in on that machine the previous account's in-flight writes.
   */
  scope: string;
  children: ReactNode;
}

/**
 * Makes the pending set available to everything below it.
 *
 * ⚠️ **Mount this above the plain routes, not only the workspace.** A create is
 * `/<basePath>/new` on the route host, so a provider inside `WorkspaceShell`
 * would never see the only kind of write that is transactional today.
 */
export function PendingTransactionsProvider({
  scope,
  children,
}: PendingTransactionsProviderProps) {
  const pending = usePendingState(state => state.pending);
  const began = usePendingState(state => state.began);
  const attach = usePendingState(state => state.attach);
  const settle = usePendingState(state => state.settle);
  const fail = usePendingState(state => state.fail);
  const dismiss = usePendingState(state => state.dismiss);

  // ⚠️ The scope is applied *before* the read, never after: the storage key is
  // what decides whose in-flight writes come back, so setting it late would
  // restore the unscoped set first and only then start writing to the right key.
  //
  // ⚠️ **And the read happens once per scope, not once per mount.** Measured on
  // the live fleet: `rehydrate()` *replaces* in-memory state with what is on
  // disk, and the disk write that follows a `began` is asynchronous — so a
  // second call (a remount, or React's development double-invoke) lands between
  // the two and wipes the very entry that was just recorded. The symptom is a
  // notice that appears and vanishes, with the write still in flight.
  //
  // Unlike `WorkspaceShell` there is no hydration *gate*, deliberately: this
  // provider wraps every authenticated page, so holding render back on an
  // IndexedDB read would blank the whole app on each load. A tab set has to
  // gate; a pending set has nothing to be wrong about while it is still empty.
  useEffect(() => {
    if (hydratedScope === scope) return;
    hydratedScope = scope;
    usePendingState.persist.setOptions({ name: `pending:${scope}` });
    // `rehydrate()` is typed `void | Promise<void>`, hence the wrap.
    void Promise.resolve(usePendingState.persist.rehydrate());
  }, [scope]);

  const store = useMemo<PendingTransactionStore>(
    () => ({
      entries: Object.values(pending),
      began,
      attach,
      settle,
      fail,
      dismiss,
    }),
    [pending, began, attach, settle, fail, dismiss],
  );

  return (
    <PendingTransactionsContext value={store}>
      {children}
    </PendingTransactionsContext>
  );
}

/** The pending set, or a store that watches nothing outside a provider. */
export function usePendingTransactions(): PendingTransactionStore {
  return useContext(PendingTransactionsContext);
}

/** The entries for one entity, which is what a list renders a notice from. */
export function pendingFor(
  store: PendingTransactionStore,
  entity: string,
): readonly PendingEntry[] {
  return store.entries.filter(entry => entry.entity === entity);
}

/**
 * The records a list should show that its own query cannot yet return.
 *
 * ⚠️ **Why this is not a cache patch.** Writing the row into the TanStack cache
 * looks simpler and does not survive: the list refetches on mount — which is
 * exactly when the operator arrives, having just been navigated here — and the
 * server legitimately does not have the record yet, so the refetch replaces the
 * patched page and the row disappears. The pending set outlives every refetch,
 * so merging at render time is the only version that holds until the write
 * actually settles.
 *
 * A failed entry contributes no row: the write did not happen, and the notice
 * beside the table is what says so.
 */
export function pendingRecordsFor<TRecord>(
  store: PendingTransactionStore,
  entity: string,
): TRecord[] {
  return store.entries
    .filter(entry => entry.entity === entity && entry.state === 'pending')
    .map(entry => entry.record)
    .filter((record): record is TRecord => record !== undefined);
}
