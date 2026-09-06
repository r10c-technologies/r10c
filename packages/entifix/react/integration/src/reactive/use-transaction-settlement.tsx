'use client';

import type {
  PendingEntry,
  PendingTransactionStore,
  TransactionRecord,
} from '@r10c/entifix-transactions';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { entityQueryScopeFor } from '../query/entity-query-key';
import type { ReactiveChannel } from './reactive-channel';

/** How often to re-ask while anything is pending. */
const DEFAULT_POLL_MS = 30_000;

export interface UseTransactionSettlementOptions {
  /** The stream outcomes arrive on, and whose reconnects trigger a re-query. */
  channel: ReactiveChannel;
  /**
   * The writes being watched.
   *
   * Passed in rather than imported: the store is a shell concern
   * (`layer:shell`) and this hook is `layer:entifix`, which may not depend
   * upward. Same seam, and the same reason, as `EntityDraftStore` for autosave.
   */
  pending: PendingTransactionStore;
  /** Reads one record. `undefined` means *not tracked yet* — never *failed*. */
  read: (transactionId: string) => Promise<TransactionRecord | undefined>;
  pollIntervalMs?: number;
}

/**
 * Settles the optimistic writes this browser started.
 *
 * Three things drive it, and they exist for three different failures:
 *
 * - **The stream**, the fast path: `transaction.completed` and
 *   `transaction.failed` carry the correlation id, so an outcome lands in the
 *   moment it happens.
 * - **`onConnect`**, because the stream does not replay (ADR 0036). It fires on
 *   every open *including for a listener registered while already connected*, so
 *   a page load holding a restored pending set and an in-session reconnect take
 *   one path rather than two.
 * - **An interval**, because `STALE` is written by the recovery sweep and emits
 *   no event at all — it is reachable only by asking. It runs only while
 *   something is pending, so an idle workspace polls nothing.
 *
 * ⚠️ **A missing record keeps the entry pending.** `accepted` reaches the
 * tracker over the bus, so with the broker down the entity write commits while
 * no event is ever published and the tracker holds nothing. Rolling back there
 * un-renders a healthy write at exactly the moment nobody can tell a UI bug from
 * an outage. Only `FAILED` and `STALE` are terminal.
 */
export function useTransactionSettlement({
  channel,
  pending,
  read,
  pollIntervalMs = DEFAULT_POLL_MS,
}: UseTransactionSettlementOptions): void {
  const queryClient = useQueryClient();

  // The store is rebuilt whenever an entry changes and `read` is typically
  // inline, so both are held in refs: keying the subscription on their identity
  // would tear down and re-open the stream every time a write settled.
  const pendingRef = useRef(pending);
  const readRef = useRef(read);

  // Refs may not be written during render. This runs before the effects below,
  // since effects fire in declaration order, so they always see the latest.
  useEffect(() => {
    pendingRef.current = pending;
    readRef.current = read;
  });

  const invalidate = useCallback(
    (entity: string) =>
      void queryClient.invalidateQueries({
        queryKey: entityQueryScopeFor(entity),
      }),
    [queryClient],
  );

  /**
   * Applies whatever the tracker currently says about one entry.
   *
   * The single place the terminal-state rule lives — the stream path, the
   * reconnect path and the interval all come through here, so there is one
   * answer to "what does this state mean" rather than three that can drift.
   */
  const reconcile = useCallback(
    async (entry: PendingEntry): Promise<void> => {
      const record = await readRef.current(entry.transactionId).catch(
        // The tracker being unreachable says nothing about the write. Keeping
        // the entry is what makes a service restart converge instead of dropping
        // every optimistic row on the floor.
        () => undefined,
      );

      // ⚠️ Not tracked yet, or still running. Either way it is not over, and
      // this is the branch that must not be turned into a rollback.
      if (record === undefined || record.state === 'PENDING') return;

      if (record.state === 'COMPLETED') {
        pendingRef.current.settle(entry.transactionId);
      } else {
        // `record.error` is free text from whatever threw — diagnostic detail
        // beside a translated headline, never the message itself.
        pendingRef.current.fail(entry.transactionId, record.error);
      }
      invalidate(entry.entity);
    },
    [invalidate],
  );

  const reconcileAll = useCallback(() => {
    for (const entry of pendingRef.current.entries) {
      if (entry.state === 'pending') void reconcile(entry);
    }
  }, [reconcile]);

  useEffect(() => {
    const stopListening = channel.subscribe(event => {
      const transactionId = event.correlationId;
      if (transactionId === undefined) return;

      const entry = pendingRef.current.entries.find(
        candidate => candidate.transactionId === transactionId,
      );
      // An id this browser never started belongs to another tab or another
      // session — the stream is organization-scoped, not connection-scoped.
      if (entry === undefined) return;

      if (event.name === 'transaction.completed') {
        pendingRef.current.settle(transactionId);
        invalidate(event.data.entity);
        return;
      }

      if (event.name === 'transaction.failed') {
        // The frame carries no reason: `EntityChangeEvent` collapses four states
        // into created/deleted and holds no `error`. So the record is re-read
        // rather than the payload widened (ADR 0036's hint-versus-record split).
        void reconcile(entry);
      }
    });

    const stopWatchingConnections = channel.onConnect(reconcileAll);

    return () => {
      stopListening();
      stopWatchingConnections();
    };
  }, [channel, invalidate, reconcile, reconcileAll]);

  // Keyed on whether anything is watched at all, not on the entries: that flips
  // once per transition rather than on every settle, so the timer is not torn
  // down and rebuilt each time a write lands.
  const watching = pending.entries.length > 0;

  useEffect(() => {
    if (!watching) return;

    const timer = setInterval(reconcileAll, pollIntervalMs);
    return () => clearInterval(timer);
  }, [watching, pollIntervalMs, reconcileAll]);
}
