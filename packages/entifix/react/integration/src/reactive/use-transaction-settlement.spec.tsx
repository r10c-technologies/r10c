import type {
  PendingEntry,
  PendingTransactionStore,
  TransactionRecord,
  TransactionState,
} from '@r10c/entifix-transactions';
import type { DomainEvent, EntityChangeEvent } from '@r10c/entifix-ts-core';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EntifixQueryProvider,
  makeQueryClient,
} from '../query/query-provider.js';
import {
  type InMemoryReactiveChannel,
  makeInMemoryReactiveChannel,
} from './reactive-channel.js';
import { useTransactionSettlement } from './use-transaction-settlement.js';

const TX = 'txn-1';

const anEntry = (state: PendingEntry['state'] = 'pending'): PendingEntry => ({
  transactionId: TX,
  entity: 'widget',
  at: '2026-09-02T00:00:00.000Z',
  state,
});

const aRecord = (
  state: TransactionState,
  error?: string,
): TransactionRecord => ({
  transactionId: TX,
  entity: 'widget',
  state,
  error,
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:01.000Z',
});

// `correlationId` takes no default on purpose: passing `undefined` to a
// defaulted parameter *triggers* the default, so a spec meaning "no correlation
// id" would silently assert the opposite of what it reads as.
const outcome = (
  name: string,
  correlationId: string | undefined,
): DomainEvent<EntityChangeEvent> => ({
  name,
  id: `${correlationId ?? 'none'}:step`,
  source: 'marketplace-admin',
  at: '2026-09-02T00:00:00.000Z',
  correlationId,
  data: { entity: 'widget', change: 'created', id: 'w-1' },
});

/**
 * A store with spies, standing in for the shell's zustand-backed one.
 *
 * `satisfies` rather than a type annotation: an annotation widens each member to
 * the port's plain signature, which loses the `Mock` type the assertions below
 * need — and an intersection with `ReturnType<typeof vi.fn>` does not type-check,
 * because an untyped `vi.fn()` is `Mock<Procedure | Constructable>`. Typing each
 * mock with its own signature keeps both halves.
 */
const makeStore = (entries: PendingEntry[]) =>
  ({
    entries,
    began: vi.fn<(pending: PendingEntry) => void>(),
    attach: vi.fn<(transactionId: string, record: unknown) => boolean>(),
    settle: vi.fn<(transactionId: string) => void>(),
    fail: vi.fn<(transactionId: string, reason?: string) => void>(),
    dismiss: vi.fn<(transactionId: string) => void>(),
  }) satisfies PendingTransactionStore;

const setup = ({
  entries = [anEntry()],
  read = vi.fn().mockResolvedValue(undefined),
  channel = makeInMemoryReactiveChannel(),
}: {
  entries?: PendingEntry[];
  read?: (id: string) => Promise<TransactionRecord | undefined>;
  channel?: InMemoryReactiveChannel;
} = {}) => {
  const client = makeQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const pending = makeStore(entries);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EntifixQueryProvider client={client}>{children}</EntifixQueryProvider>
  );

  const view = renderHook(
    () => useTransactionSettlement({ channel, pending, read }),
    { wrapper },
  );

  return { channel, pending, invalidate, read, view };
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settling from the stream', () => {
  it('settles a watched write and refreshes its list', async () => {
    const { channel, pending, invalidate } = setup();

    channel.emit(outcome('transaction.completed', TX));

    await waitFor(() => expect(pending.settle).toHaveBeenCalledWith(TX));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entity', 'widget'] });
  });

  // The frame carries no reason — `EntityChangeEvent` collapses four states into
  // created/deleted and holds no `error` — so the record is re-read rather than
  // the payload widened.
  it('re-reads the record for a failure, because the frame carries no reason', async () => {
    const read = vi.fn().mockResolvedValue(aRecord('FAILED', 'duplicate code'));
    const { channel, pending } = setup({ read });

    channel.emit(outcome('transaction.failed', TX));

    await waitFor(() =>
      expect(pending.fail).toHaveBeenCalledWith(TX, 'duplicate code'),
    );
    expect(read).toHaveBeenCalledWith(TX);
  });

  // The stream is organization-scoped, not connection-scoped, so another tab's
  // write legitimately arrives here.
  it('ignores an outcome for a write it never started', async () => {
    const { channel, pending } = setup();

    channel.emit(outcome('transaction.completed', 'someone-else'));

    await Promise.resolve();
    expect(pending.settle).not.toHaveBeenCalled();
  });

  it('ignores a frame carrying no correlation id', async () => {
    const { channel, pending } = setup();

    channel.emit(outcome('transaction.completed', undefined));

    await Promise.resolve();
    expect(pending.settle).not.toHaveBeenCalled();
  });

  // `transaction.accepted` is an acknowledgement, not an outcome: the write is
  // exactly as pending after it as before.
  it('leaves a write pending on an accepted frame', async () => {
    const { channel, pending } = setup();

    channel.emit(outcome('transaction.accepted', TX));

    await Promise.resolve();
    expect(pending.settle).not.toHaveBeenCalled();
    expect(pending.fail).not.toHaveBeenCalled();
  });
});

describe('reconciling on connect', () => {
  // The path that makes a page load with a restored pending set converge, and
  // the one that recovers an outcome missed while the stream was down.
  it('re-queries every pending write when the stream connects', async () => {
    const read = vi.fn().mockResolvedValue(aRecord('COMPLETED'));
    const { channel, pending } = setup({ read });

    channel.connect();

    await waitFor(() => expect(pending.settle).toHaveBeenCalledWith(TX));
  });

  it('does not re-query an entry that already failed', async () => {
    const read = vi.fn().mockResolvedValue(aRecord('FAILED'));
    const { channel } = setup({ entries: [anEntry('failed')], read });

    channel.connect();

    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
  });

  // ⚠️ The rule the whole design turns on. With the broker down the write
  // commits but no `accepted` ever reaches the tracker, so it holds nothing —
  // and rolling back there would un-render a write that is about to appear.
  it('keeps a write pending when the tracker has no record of it', async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const { channel, pending, invalidate } = setup({ read });

    channel.connect();

    await waitFor(() => expect(read).toHaveBeenCalledWith(TX));
    expect(pending.settle).not.toHaveBeenCalled();
    expect(pending.fail).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('keeps a write pending while the tracker still says PENDING', async () => {
    const read = vi.fn().mockResolvedValue(aRecord('PENDING'));
    const { channel, pending } = setup({ read });

    channel.connect();

    await waitFor(() => expect(read).toHaveBeenCalledWith(TX));
    expect(pending.settle).not.toHaveBeenCalled();
    expect(pending.fail).not.toHaveBeenCalled();
  });

  // The tracker being unreachable says nothing about the write, so a failed read
  // must converge on the next attempt rather than drop the row.
  it('keeps a write pending when the read itself fails', async () => {
    const read = vi.fn().mockRejectedValue(new Error('service down'));
    const { channel, pending } = setup({ read });

    channel.connect();

    await waitFor(() => expect(read).toHaveBeenCalledWith(TX));
    expect(pending.settle).not.toHaveBeenCalled();
    expect(pending.fail).not.toHaveBeenCalled();
  });
});

describe('reconciling on an interval', () => {
  // `STALE` is written by the recovery sweep and emits no event at all, so an
  // interval is the only way it is ever discovered.
  it('finds a STALE write, which the stream can never announce', async () => {
    const read = vi.fn().mockResolvedValue(aRecord('STALE'));
    const { pending } = setup({ read });

    await vi.advanceTimersByTimeAsync(30_000);

    await waitFor(() =>
      expect(pending.fail).toHaveBeenCalledWith(TX, undefined),
    );
  });

  // An idle workspace must not poll: the timer exists for writes in flight, and
  // there are none.
  it('polls nothing while there is nothing pending', async () => {
    const read = vi.fn().mockResolvedValue(aRecord('COMPLETED'));
    setup({ entries: [], read });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(read).not.toHaveBeenCalled();
  });
});
