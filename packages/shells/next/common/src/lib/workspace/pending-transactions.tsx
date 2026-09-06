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
  settle: () => undefined,
  fail: () => undefined,
  dismiss: () => undefined,
};

const PendingTransactionsContext =
  createContext<PendingTransactionStore>(noopStore);

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
  const settle = usePendingState(state => state.settle);
  const fail = usePendingState(state => state.fail);
  const dismiss = usePendingState(state => state.dismiss);

  // ⚠️ The scope is applied *before* the read, never after: the storage key is
  // what decides whose in-flight writes come back, so setting it late would
  // restore the unscoped set first and only then start writing to the right key.
  //
  // Unlike `WorkspaceShell` there is no hydration gate here, deliberately. This
  // provider wraps every authenticated page, so holding render back on an
  // IndexedDB read would blank the whole app on each load — and it buys nothing,
  // because the store starts empty and its subscribers re-render when the read
  // lands. A tab set has to gate; a pending set has nothing to be wrong about
  // while it is still empty.
  useEffect(() => {
    usePendingState.persist.setOptions({ name: `pending:${scope}` });
    // `rehydrate()` is typed `void | Promise<void>`, hence the wrap.
    void Promise.resolve(usePendingState.persist.rehydrate());
  }, [scope]);

  const store = useMemo<PendingTransactionStore>(
    () => ({
      entries: Object.values(pending),
      began,
      settle,
      fail,
      dismiss,
    }),
    [pending, began, settle, fail, dismiss],
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
