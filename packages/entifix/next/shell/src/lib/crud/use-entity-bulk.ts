'use client';

import {
  type BulkOutcome,
  emptySelection,
  type Entity,
  type EntityId,
  type EntitySelection,
} from '@r10c/entifix-ts-core';
import { useCallback, useState } from 'react';

/**
 * The code a row carries when the *request* failed rather than the row.
 *
 * `unexpected` is the shared fallback the `errors` catalog already ships, and
 * it is the honest label: what went wrong is not something this row did.
 */
const BULK_REQUEST_FAILED = 'unexpected';

export interface UseEntityBulkOptions<TEntity extends Entity> {
  /**
   * Runs one `collection`-bound verb. Absent means this listing has no bulk
   * actions, and no selection column is rendered at all.
   */
  readonly run?: (
    key: string,
    selection: EntitySelection<TEntity>,
  ) => Promise<readonly BulkOutcome[]>;
  /** Called after a run, so the listing can re-read the rows it just changed. */
  readonly onCompleted?: () => void;
  /** The whole request failed — a transport error, not a per-row outcome. */
  readonly onError?: (error: unknown) => void;
}

/** The props {@link useEntityBulk} contributes to `EntityTable`. */
export interface EntityBulkTableProps<TEntity extends Entity> {
  selection?: EntitySelection<TEntity>;
  onSelectionChange?: (selection: EntitySelection<TEntity>) => void;
  onBulkUseCase?: (key: string, selection: EntitySelection<TEntity>) => void;
  bulkOutcomes?: readonly BulkOutcome[];
  onBulkDismiss?: () => void;
  onBulkRetry?: (ids: EntityId[]) => void;
  isBulkRunning?: boolean;
}

/**
 * Owns a listing's selection and the result of the last bulk run.
 *
 * The selection lives here rather than inside `EntityTable` because it has to
 * survive pagination, and the page owns the pager — a selection reset by the
 * very navigation used to add to it would make "select rows across pages"
 * impossible.
 *
 * Two behaviours worth not re-deriving. **The selection survives the action**
 * (#121): after a run the rows stay ticked, because the operator's next act is
 * usually to retry the failures or to run a second verb on the same rows, and
 * re-selecting forty rows to do it is the whole cost the bulk bar exists to
 * remove. And **a retry re-runs only the failures**, as an `ids` selection
 * built from the outcomes — never the original selection, which would redo the
 * successful rows and, for a `matching` selection, re-resolve a filter whose
 * answer has just changed underneath it.
 */
export function useEntityBulk<TEntity extends Entity>({
  run,
  onCompleted,
  onError,
}: UseEntityBulkOptions<TEntity>): {
  tableProps: EntityBulkTableProps<TEntity>;
} {
  const [selection, setSelection] = useState<EntitySelection<TEntity>>(() =>
    emptySelection<TEntity>(),
  );
  const [outcomes, setOutcomes] = useState<readonly BulkOutcome[] | undefined>(
    undefined,
  );
  const [isRunning, setRunning] = useState(false);

  const execute = useCallback(
    async (key: string, target: EntitySelection<TEntity>) => {
      // Unreachable through the UI: the handlers that call this are only
      // exposed when `run` exists. It is here because a `useCallback` cannot
      // be declared conditionally and TypeScript still has to narrow.
      /* v8 ignore next */
      if (!run) return;
      setRunning(true);
      // The previous result is cleared as the new run starts: leaving it up
      // would show last run's failures beside this run's spinner, and they
      // are not the same rows.
      setOutcomes(undefined);
      try {
        setOutcomes(await run(key, target));
      } catch (error) {
        // The *request* failed — the network, a `403`, a `500` — which is not a
        // per-row outcome. Caught rather than left to reject: `void execute(…)`
        // at the call site would otherwise make every failed bulk run an
        // unhandled promise rejection, which is invisible in the UI and noisy
        // in the console.
        //
        // When the rows are known it is reported as every row failing, because
        // that is what happened, and it reuses the surface that already
        // attributes failures per row. A `matching` selection has no id list to
        // attribute to — that is the whole point of the mode — so it reports
        // nothing here and the error goes to the caller instead.
        if (target.mode === 'ids') {
          setOutcomes(
            // `Array.from`, never a spread — see `toWireSelection`: the loose
            // SWC helper wraps a `Set` instead of iterating it.
            Array.from(target.ids).map(id => ({
              id,
              ok: false,
              code: BULK_REQUEST_FAILED,
            })),
          );
        }
        onError?.(error);
      } finally {
        setRunning(false);
        onCompleted?.();
      }
    },
    [run, onCompleted, onError],
  );

  const [lastKey, setLastKey] = useState<string | undefined>(undefined);

  const onBulkUseCase = useCallback(
    (key: string, target: EntitySelection<TEntity>) => {
      setLastKey(key);
      void execute(key, target);
    },
    [execute],
  );

  const onBulkRetry = useCallback(
    (ids: EntityId[]) => {
      if (lastKey === undefined) return;
      void execute(lastKey, { mode: 'ids', ids: new Set(ids) });
    },
    [execute, lastKey],
  );

  if (!run) return { tableProps: {} };

  return {
    tableProps: {
      selection,
      onSelectionChange: setSelection,
      onBulkUseCase,
      bulkOutcomes: outcomes,
      onBulkDismiss: () => setOutcomes(undefined),
      onBulkRetry,
      isBulkRunning: isRunning,
    },
  };
}
