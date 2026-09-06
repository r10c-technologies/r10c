import 'fake-indexeddb/auto';

import type { PendingTransaction } from '@r10c/entifix-transactions';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_PENDING,
  mergePending,
  migratePending,
  type PendingState,
  persistedPending,
  usePendingState,
} from './pending-state.js';

const TX = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const aPending = (
  transactionId = TX,
  at = '2026-07-20T12:00:00.000Z',
): PendingTransaction => ({ transactionId, entity: 'product', at });

afterEach(() => {
  usePendingState.setState({ pending: {} });
});

describe('usePendingState', () => {
  it('records a write as pending, keyed by its transaction id', () => {
    usePendingState.getState().began(aPending());

    expect(usePendingState.getState().pending[TX]).toEqual({
      ...aPending(),
      state: 'pending',
    });
  });

  // Settling drops the entry: the server's copy is the truth now, and the list
  // query that just refetched is the thing showing it.
  it('drops an entry that settles', () => {
    usePendingState.getState().began(aPending());
    usePendingState.getState().settle(TX);

    expect(TX in usePendingState.getState().pending).toBe(false);
  });

  // A failure is kept, marked, until someone reads it — dropping it here would
  // un-render the optimistic row and say nothing about why.
  it('keeps a failed entry, with its reason', () => {
    usePendingState.getState().began(aPending());
    usePendingState.getState().fail(TX, 'duplicate code');

    expect(usePendingState.getState().pending[TX]).toMatchObject({
      state: 'failed',
      reason: 'duplicate code',
    });
  });

  it('drops a failed entry once it is dismissed', () => {
    usePendingState.getState().began(aPending());
    usePendingState.getState().fail(TX, 'duplicate code');
    usePendingState.getState().dismiss(TX);

    expect(TX in usePendingState.getState().pending).toBe(false);
  });

  // An outcome for a transaction this browser never started belongs to another
  // tab or another session; acting on it would invent an entry.
  it('ignores an outcome for an id it never recorded', () => {
    const before = usePendingState.getState().pending;

    usePendingState.getState().settle('unknown');
    usePendingState.getState().fail('unknown', 'boom');
    usePendingState.getState().dismiss('unknown');

    expect(usePendingState.getState().pending).toBe(before);
  });

  // The cap keeps the persisted set bounded and the reconnect fan-out a handful
  // of requests. An evicted entry is dropped silently: the record is still on
  // the server, and the list's own query is the fallback.
  it('evicts the oldest entries past the cap', () => {
    for (let index = 0; index <= MAX_PENDING; index += 1) {
      usePendingState
        .getState()
        .began(
          aPending(
            `tx-${index}`,
            `2026-07-20T12:00:${String(index).padStart(2, '0')}.000Z`,
          ),
        );
    }

    const { pending } = usePendingState.getState();

    expect(Object.keys(pending)).toHaveLength(MAX_PENDING);
    expect('tx-0' in pending).toBe(false);
    expect(`tx-${MAX_PENDING}` in pending).toBe(true);
  });
});

describe('persistence', () => {
  it('persists only the entries, never the actions', () => {
    const state = {
      pending: { [TX]: { ...aPending(), state: 'pending' as const } },
    } as PendingState;

    expect(Object.keys(persistedPending(state))).toEqual(['pending']);
  });

  // An entry is a claim that something is still in flight, and it stops being
  // true on its own — so a shape this build cannot read is discarded rather than
  // migrated into a watch on a transaction that settled hours ago.
  it('discards everything on a version bump', () => {
    expect(migratePending()).toEqual({ pending: {} });
  });

  it('restores the entries it understands', () => {
    const current = usePendingState.getState();

    const merged = mergePending(
      { pending: { [TX]: { ...aPending(), state: 'pending' } } },
      current,
    );

    expect(merged.pending[TX]).toMatchObject({ state: 'pending' });
  });

  // Per entry rather than all-or-nothing, so one record written by a build that
  // predates the shape does not take the rest of the pending set with it.
  it('drops a malformed entry and keeps the rest', () => {
    const merged = mergePending(
      {
        pending: {
          [TX]: { ...aPending(), state: 'pending' },
          'bad-state': { ...aPending('bad-state'), state: 'elsewhere' },
          'not-an-object': 'nope',
          'missing-members': { transactionId: 'missing-members' },
          'is-null': null,
        },
      },
      usePendingState.getState(),
    );

    expect(Object.keys(merged.pending)).toEqual([TX]);
  });

  it('keeps the current state when nothing was persisted', () => {
    const current = usePendingState.getState();

    expect(mergePending(undefined, current)).toBe(current);
    expect(mergePending({ pending: null }, current)).toBe(current);
  });
});

describe('holding the record a list has to show', () => {
  // The row must outlive the list's own refetch, which a cache patch cannot:
  // the server legitimately has no record yet, so a refetch would drop it.
  it('attaches the record and says the write was being watched', () => {
    usePendingState.getState().began(aPending());

    const attached = usePendingState.getState().attach(TX, { id: TX });

    expect(attached).toBe(true);
    expect(usePendingState.getState().pending[TX]?.record).toEqual({ id: TX });
  });

  // ⚠️ This is how a caller tells a transactional create from a plain one, and
  // it has to answer from current state: a save handler asking `entries` first
  // would be reading a closure captured before its own `await`.
  it('answers false for a write nobody announced', () => {
    expect(usePendingState.getState().attach('never-seen', {})).toBe(false);
    expect(usePendingState.getState().pending).toEqual({});
  });

  // A class instance does not survive a JSON round trip, so the payload is
  // dropped on the way to IndexedDB and only the watch is restored.
  it('strips the record before persisting', () => {
    usePendingState.getState().began(aPending());
    usePendingState.getState().attach(TX, { id: TX });

    const persisted = persistedPending(usePendingState.getState());

    expect(persisted.pending[TX]).toBeDefined();
    expect('record' in (persisted.pending[TX] ?? {})).toBe(false);
  });
});
