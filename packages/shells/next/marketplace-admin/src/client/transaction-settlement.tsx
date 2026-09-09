'use client';

import {
  makeEventSourceReactiveChannel,
  useReactiveInvalidation,
  useTransactionSettlement,
} from '@r10c/entifix-react-integration';
import { buildTransactionStatusReader } from '@r10c/entifix-ts-rest-client';
import { usePendingTransactions } from '@r10c/shells-next-common';
import { Effect } from 'effect';
import { useCallback } from 'react';

import {
  createClientAdapters,
  TRANSACTION_SERVICE,
} from './adapters/create-client-adapters';

/**
 * The reactive stream, reached **same-origin** through the `/api/admin` proxy:
 * `r10c_at` is httpOnly, so the cookie is the only credential available and a
 * cross-origin connection would carry none (ADR 0036).
 *
 * Module scope, so every mount shares one connection.
 */
// ⚠️ `/api/transaction`, not `/api/admin/transaction`. The tracker moved to
// transaction-service on `:3103` (#229), and this path is the same-origin proxy
// in front of it — same-origin by necessity, because the session cookie is
// `httpOnly` and an `EventSource` pointed at the service directly would carry no
// credential (ADR 0036).
const reactiveChannel = makeEventSourceReactiveChannel(
  '/api/transaction/events',
);

/**
 * Mounts the stream for the whole authenticated area — invalidation and
 * settlement both.
 *
 * ⚠️ **Not inside the workspace.** It used to be, and that was correct while the
 * only consumer was tab-local invalidation. It is wrong for settlement: a create
 * is `/<basePath>/new` on the *plain* route, outside any `WorkspaceShell`, so a
 * stream mounted there would never see the outcome of the only kind of write
 * that is transactional. It sits beside `PendingTransactionsProvider`, at the
 * same level and for the same reason.
 *
 * Renders nothing. It is a mount point, not a widget.
 */
export function TransactionSettlement() {
  const pending = usePendingTransactions();

  const read = useCallback(
    (transactionId: string) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(
            buildTransactionStatusReader(TRANSACTION_SERVICE),
            reader => reader.read(transactionId),
          ),
          createClientAdapters().configurationStore,
        ),
      ),
    [],
  );

  useReactiveInvalidation(reactiveChannel);
  useTransactionSettlement({ channel: reactiveChannel, pending, read });

  return null;
}
