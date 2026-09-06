'use client';

import type {
  PendingEntry,
  PendingTransaction,
} from '@r10c/entifix-transactions';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { makeIndexedDbStateStorage } from './idb-state-storage';
import { WORKSPACE_DB } from './tabs-state';

/**
 * Writes the browser started and the server has not finished, keyed by
 * transaction id.
 *
 * ⚠️ **This is not workspace state, and the distinction is load-bearing.** Tabs
 * and drafts belong to the workspace and are scoped by `WorkspaceShell`; a
 * pending write is not, because a create happens at `/<basePath>/new` on the
 * plain route, outside any `WorkspaceShell` (a generated list still uses plain
 * `href`s — ADR 0042's own residual). A store mounted inside the workspace would
 * be written to by nothing, or — worse — written to *before* `persist.setOptions`
 * had scoped it, which is the unscoped cross-account restore ADR 0032 exists to
 * prevent. So `PendingTransactionsProvider` sits at the authenticated layout
 * instead, above both.
 *
 * It shares the workspace's IndexedDB database because it is the same browser
 * profile and the same scope key, not because it is the same concern.
 */
export interface PendingState {
  pending: Record<string, PendingEntry>;
  began(transaction: PendingTransaction): void;
  settle(transactionId: string): void;
  fail(transactionId: string, reason?: string): void;
  dismiss(transactionId: string): void;
}

export function persistedPending(
  store: PendingState,
): Pick<PendingState, 'pending'> {
  return { pending: store.pending };
}

const PENDING_STORE = 'stores';

/**
 * How many pending writes are watched at once, oldest evicted first.
 *
 * The same reasoning as {@link MAX_TABS}: an unbounded set persisted to
 * IndexedDB grows without anything ever pruning it, and reconciliation asks the
 * tracker once per entry on every reconnect — so the cap is also what keeps that
 * fan-out a handful of requests rather than an unbounded one.
 *
 * An evicted entry is dropped silently. The record is still on the server and
 * the list's own query is the fallback; what is lost is only the watching.
 */
export const MAX_PENDING = 12;

/**
 * Bump when the *shape* of an entry changes, and every persisted pending write
 * is discarded on the next load.
 *
 * Discarding is right here for a reason the other two stores do not share: an
 * entry is a claim that something is still in flight, and it stops being true on
 * its own. A stale one restored from a previous build watches a transaction that
 * settled hours ago, and the reconcile that would correct it is keyed on a shape
 * this build may no longer understand.
 */
export const PENDING_VERSION = 1;

const emptyPending: Pick<PendingState, 'pending'> = { pending: {} };

/**
 * Discard, never guess — written out rather than left to zustand's default,
 * which discards too but logs an error for a decision that was made on purpose.
 * Same call as `migrateDrafts` and `migrateTabs`.
 */
export function migratePending(): Pick<PendingState, 'pending'> {
  return emptyPending;
}

/** Whether a restored value is an entry this build can act on. */
function isPendingEntry(value: unknown): value is PendingEntry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<PendingEntry>;
  return (
    typeof entry.transactionId === 'string' &&
    typeof entry.entity === 'string' &&
    typeof entry.at === 'string' &&
    (entry.state === 'pending' || entry.state === 'failed')
  );
}

/**
 * Restores only the entries that are actually entries — per entry, so one bad
 * record does not take the rest with it. The `mergeDrafts` rule, for the same
 * reason: this is what happens when something else was written by a build that
 * predates the shape.
 */
export function mergePending(
  persistedState: unknown,
  currentState: PendingState,
): PendingState {
  const restored = (persistedState as Partial<PendingState> | undefined)
    ?.pending;
  if (restored === null || typeof restored !== 'object') return currentState;

  const pending: Record<string, PendingEntry> = {};
  for (const [transactionId, value] of Object.entries(restored)) {
    if (isPendingEntry(value)) pending[transactionId] = value;
  }
  return { ...currentState, pending };
}

/** Drops the oldest entries until the set fits, by announcement time. */
function capPending(
  pending: Record<string, PendingEntry>,
): Record<string, PendingEntry> {
  const entries = Object.entries(pending);
  if (entries.length <= MAX_PENDING) return pending;

  return Object.fromEntries(
    entries
      .sort(([, a], [, b]) => a.at.localeCompare(b.at))
      .slice(entries.length - MAX_PENDING),
  );
}

export const usePendingState = create<PendingState>()(
  persist(
    set => ({
      pending: {},
      began: transaction =>
        set(state => ({
          pending: capPending({
            ...state.pending,
            [transaction.transactionId]: { ...transaction, state: 'pending' },
          }),
        })),
      // Settling drops the entry rather than marking it done: the server's copy
      // is the truth now, and the list query that just refetched is showing it.
      settle: transactionId =>
        set(state => {
          if (!(transactionId in state.pending)) return state;
          const { [transactionId]: _settled, ...rest } = state.pending;
          return { pending: rest };
        }),
      // A failure is *kept*, marked, until someone reads it. Dropping it here
      // would un-render the optimistic row and say nothing about why.
      fail: (transactionId, reason) =>
        set(state => {
          const entry = state.pending[transactionId];
          if (entry === undefined) return state;
          return {
            pending: {
              ...state.pending,
              [transactionId]: { ...entry, state: 'failed', reason },
            },
          };
        }),
      dismiss: transactionId =>
        set(state => {
          if (!(transactionId in state.pending)) return state;
          const { [transactionId]: _dismissed, ...rest } = state.pending;
          return { pending: rest };
        }),
    }),
    {
      // Replaced with a scoped name before rehydrating, exactly as the tab and
      // draft stores are. This literal is only what an unscoped store would
      // write, and nothing rehydrates without passing through that call.
      name: 'pending',
      version: PENDING_VERSION,
      migrate: migratePending,
      merge: mergePending,
      storage: createJSONStorage(() =>
        makeIndexedDbStateStorage(WORKSPACE_DB, PENDING_STORE),
      ),
      partialize: persistedPending,
      skipHydration: true,
    },
  ),
);
