import type { BulkOutcome, EntitySelection } from '@r10c/entifix-ts-core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEntityBulk } from './use-entity-bulk';

interface Widget {
  id: string;
}

const idsOf = (selection: EntitySelection<Widget>): string[] =>
  selection.mode === 'ids' ? [...selection.ids].map(String) : [];

describe('useEntityBulk', () => {
  /**
   * No runner means this listing has no collection verbs, so it gets no
   * selection column either — a page of empty checkboxes nothing can act on.
   */
  it('contributes nothing without a runner', () => {
    const { result } = renderHook(() => useEntityBulk<Widget>({}));

    expect(result.current.tableProps).toEqual({});
  });

  it('holds the selection for the table', () => {
    const { result } = renderHook(() =>
      useEntityBulk<Widget>({ run: vi.fn() }),
    );

    act(() =>
      result.current.tableProps.onSelectionChange?.({
        mode: 'ids',
        ids: new Set(['a']),
      }),
    );

    expect(idsOf(result.current.tableProps.selection!)).toEqual(['a']);
  });

  it('runs a verb over the selection and keeps the outcomes', async () => {
    const outcomes: BulkOutcome[] = [
      { id: 'a', ok: true },
      { id: 'b', ok: false, code: 'alreadyRetired' },
    ];
    const run = vi.fn().mockResolvedValue(outcomes);
    const { result } = renderHook(() => useEntityBulk<Widget>({ run }));

    act(() =>
      result.current.tableProps.onBulkUseCase?.('retire', {
        mode: 'ids',
        ids: new Set(['a', 'b']),
      }),
    );

    await waitFor(() =>
      expect(result.current.tableProps.bulkOutcomes).toEqual(outcomes),
    );
    expect(run).toHaveBeenCalledWith(
      'retire',
      expect.objectContaining({ mode: 'ids' }),
    );
  });

  /**
   * #121: "the selection is still there afterwards". The operator's next act is
   * usually to retry the failures or run a second verb on the same rows, and
   * re-ticking forty rows to do it is the cost the bulk bar exists to remove.
   */
  it('leaves the selection in place after a run', async () => {
    const run = vi.fn().mockResolvedValue([{ id: 'a', ok: true }]);
    const { result } = renderHook(() => useEntityBulk<Widget>({ run }));

    act(() =>
      result.current.tableProps.onSelectionChange?.({
        mode: 'ids',
        ids: new Set(['a']),
      }),
    );
    act(() =>
      result.current.tableProps.onBulkUseCase?.('retire', {
        mode: 'ids',
        ids: new Set(['a']),
      }),
    );

    await waitFor(() =>
      expect(result.current.tableProps.bulkOutcomes).toBeDefined(),
    );
    expect(idsOf(result.current.tableProps.selection!)).toEqual(['a']);
  });

  it('tells the listing to re-read the rows it changed', async () => {
    const onCompleted = vi.fn();
    const run = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() =>
      useEntityBulk<Widget>({ run, onCompleted }),
    );

    act(() =>
      result.current.tableProps.onBulkUseCase?.('retire', {
        mode: 'ids',
        ids: new Set(['a']),
      }),
    );

    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  describe('when the request itself fails', () => {
    /**
     * Caught rather than left to reject: `void execute(…)` would otherwise make
     * every failed bulk run an unhandled promise rejection — invisible in the
     * UI and noisy in the console.
     */
    it('reports it to the caller and stops reporting itself busy', async () => {
      const onError = vi.fn();
      const run = vi.fn().mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() =>
        useEntityBulk<Widget>({ run, onError }),
      );

      act(() =>
        result.current.tableProps.onBulkUseCase?.('retire', {
          mode: 'ids',
          ids: new Set(['a']),
        }),
      );

      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(result.current.tableProps.isBulkRunning).toBe(false);
    });

    /** Every row did fail, so every row says so — through the same surface. */
    it('attributes the failure to each selected row', async () => {
      const run = vi.fn().mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useEntityBulk<Widget>({ run }));

      act(() =>
        result.current.tableProps.onBulkUseCase?.('retire', {
          mode: 'ids',
          ids: new Set(['a', 'b']),
        }),
      );

      await waitFor(() =>
        expect(result.current.tableProps.bulkOutcomes).toEqual([
          { id: 'a', ok: false, code: 'unexpected' },
          { id: 'b', ok: false, code: 'unexpected' },
        ]),
      );
    });

    /**
     * A `matching` selection has no id list to attribute to — that is the whole
     * point of the mode — so it reports nothing per row.
     */
    it('attributes nothing per row for a matching selection', async () => {
      const onError = vi.fn();
      const run = vi.fn().mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() =>
        useEntityBulk<Widget>({ run, onError }),
      );

      act(() =>
        result.current.tableProps.onBulkUseCase?.('retire', {
          mode: 'matching',
          total: 3200,
          excluded: new Set(),
        }),
      );

      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(result.current.tableProps.bulkOutcomes).toBeUndefined();
    });
  });

  describe('retry', () => {
    /**
     * The failures **only** — never the original selection, which would redo
     * the rows that succeeded and, for a `matching` selection, re-resolve a
     * filter whose answer has just changed underneath it.
     */
    it('re-runs the failed ids under the same verb', async () => {
      const run = vi.fn().mockResolvedValue([
        { id: 'a', ok: true },
        { id: 'b', ok: false, code: 'alreadyRetired' },
      ]);
      const { result } = renderHook(() => useEntityBulk<Widget>({ run }));

      act(() =>
        result.current.tableProps.onBulkUseCase?.('retire', {
          mode: 'matching',
          total: 3200,
          excluded: new Set(),
        }),
      );
      await waitFor(() =>
        expect(result.current.tableProps.bulkOutcomes).toBeDefined(),
      );

      act(() => result.current.tableProps.onBulkRetry?.(['b']));

      await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
      expect(run.mock.calls[1]).toEqual([
        'retire',
        { mode: 'ids', ids: new Set(['b']) },
      ]);
    });

    it('does nothing when no verb has run yet', () => {
      const run = vi.fn();
      const { result } = renderHook(() => useEntityBulk<Widget>({ run }));

      act(() => result.current.tableProps.onBulkRetry?.(['b']));

      expect(run).not.toHaveBeenCalled();
    });
  });

  it('clears the result on dismissal', async () => {
    const run = vi.fn().mockResolvedValue([{ id: 'a', ok: true }]);
    const { result } = renderHook(() => useEntityBulk<Widget>({ run }));

    act(() =>
      result.current.tableProps.onBulkUseCase?.('retire', {
        mode: 'ids',
        ids: new Set(['a']),
      }),
    );
    await waitFor(() =>
      expect(result.current.tableProps.bulkOutcomes).toBeDefined(),
    );

    act(() => result.current.tableProps.onBulkDismiss?.());

    expect(result.current.tableProps.bulkOutcomes).toBeUndefined();
  });
});
