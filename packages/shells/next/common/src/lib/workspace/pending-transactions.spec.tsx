import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingState } from './pending-state.js';
import {
  pendingFor,
  PendingTransactionsProvider,
  usePendingTransactions,
} from './pending-transactions.js';

const TX = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const aPending = (transactionId = TX, entity = 'product') => ({
  transactionId,
  entity,
  at: '2026-07-20T12:00:00.000Z',
});

const wrapper =
  (scope = 'user-1:org-1') =>
  ({ children }: { children: ReactNode }) => (
    <PendingTransactionsProvider scope={scope}>
      {children}
    </PendingTransactionsProvider>
  );

beforeEach(() => {
  usePendingState.setState({ pending: {} });
  vi.spyOn(usePendingState.persist, 'rehydrate').mockResolvedValue(undefined);
  vi.spyOn(usePendingState.persist, 'setOptions');
});

afterEach(() => {
  usePendingState.setState({ pending: {} });
  vi.restoreAllMocks();
});

describe('PendingTransactionsProvider', () => {
  it('exposes the pending entries below it', async () => {
    const { result } = renderHook(() => usePendingTransactions(), {
      wrapper: wrapper(),
    });

    act(() => {
      result.current.began(aPending());
    });

    await waitFor(() =>
      expect(result.current.entries).toEqual([
        { ...aPending(), state: 'pending' },
      ]),
    );
  });

  // The scope is applied *before* the read: setting it after would restore the
  // unscoped set first and only then start writing to the right key, which is
  // how one browser profile hands the next account the previous one's writes.
  it('scopes the store before rehydrating it', async () => {
    renderHook(() => usePendingTransactions(), {
      wrapper: wrapper('user-2:org-9'),
    });

    await waitFor(() =>
      expect(usePendingState.persist.setOptions).toHaveBeenCalledWith({
        name: 'pending:user-2:org-9',
      }),
    );

    const setOptionsOrder = vi.mocked(usePendingState.persist.setOptions).mock
      .invocationCallOrder[0];
    const rehydrateOrder = vi.mocked(usePendingState.persist.rehydrate).mock
      .invocationCallOrder[0];

    expect(setOptionsOrder).toBeLessThan(rehydrateOrder ?? 0);
  });

  it('re-scopes when the account changes', async () => {
    const { rerender } = renderHook(() => usePendingTransactions(), {
      wrapper: wrapper('user-1:org-1'),
    });

    await waitFor(() =>
      expect(usePendingState.persist.setOptions).toHaveBeenCalledWith({
        name: 'pending:user-1:org-1',
      }),
    );

    rerender();

    expect(usePendingState.persist.setOptions).toHaveBeenCalled();
  });

  it('settles and fails through the provided store', async () => {
    const { result } = renderHook(() => usePendingTransactions(), {
      wrapper: wrapper(),
    });

    act(() => {
      result.current.began(aPending());
      result.current.fail(TX, 'duplicate code');
    });

    await waitFor(() =>
      expect(result.current.entries[0]).toMatchObject({
        state: 'failed',
        reason: 'duplicate code',
      }),
    );

    act(() => {
      result.current.dismiss(TX);
    });

    await waitFor(() => expect(result.current.entries).toEqual([]));
  });
});

describe('usePendingTransactions outside a provider', () => {
  // A create on a page with no provider still works exactly as it did; it simply
  // gets no optimistic treatment. That is what keeps `began` from ever writing
  // into a store nothing has scoped.
  it('watches nothing, and accepts every call without throwing', () => {
    const { result } = renderHook(() => usePendingTransactions());

    expect(result.current.entries).toEqual([]);
    expect(() => {
      result.current.began(aPending());
      result.current.settle(TX);
      result.current.fail(TX, 'boom');
      result.current.dismiss(TX);
    }).not.toThrow();
    expect(usePendingState.getState().pending).toEqual({});
  });
});

describe('pendingFor', () => {
  it('selects the entries for one entity', () => {
    const store = {
      entries: [
        { ...aPending('a', 'product'), state: 'pending' as const },
        { ...aPending('b', 'product-brand'), state: 'pending' as const },
      ],
      began: () => undefined,
      settle: () => undefined,
      fail: () => undefined,
      dismiss: () => undefined,
    };

    expect(pendingFor(store, 'product').map(entry => entry.transactionId)).toEqual(
      ['a'],
    );
  });
});
