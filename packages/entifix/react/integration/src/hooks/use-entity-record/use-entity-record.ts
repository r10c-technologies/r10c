import { EntityIdTag } from '@r10c/entifix-ts-business';
import { EntifixError, type Entity } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type {
  UseEntityRecordAction,
  UseEntityRecordOptions,
  UseEntityRecordState,
} from './use-entity-record.types';

function getInitialState<TEntity extends Entity>(): UseEntityRecordState<TEntity> {
  return {
    entity: undefined,
    isLoading: false,
    error: undefined,
  };
}

function reducer<TEntity extends Entity>(
  state: UseEntityRecordState<TEntity>,
  action: UseEntityRecordAction<TEntity>
): UseEntityRecordState<TEntity> {
  return { ...state, ...action.set };
}

/**
 * Loads a single entity by id — the read half of an entity form.
 *
 * The id is provided through {@link EntityIdTag} at call time, mirroring how
 * {@link useDataLoading} provides the load request: the use-case stays
 * environment-agnostic and the hook is the only place that knows it is running
 * in React.
 *
 * When `id` is `undefined` the hook does not fetch. That is the create case —
 * there is no record yet — and it is a deliberate no-op rather than an error.
 */
export function useEntityRecord<TEntity extends Entity, TContext>({
  uc,
  ctx,
  id,
}: UseEntityRecordOptions<TEntity, TContext>) {
  const [state, dispatch] = useReducer(
    reducer as (
      state: UseEntityRecordState<TEntity>,
      action: UseEntityRecordAction<TEntity>
    ) => UseEntityRecordState<TEntity>,
    getInitialState<TEntity>()
  );
  // Bumped to re-run the fetch on demand.
  const [reloadToken, setReloadToken] = useState(0);

  // Callers build `uc`/`ctx` inline, so they are fresh objects on every render.
  // Holding the latest in refs keeps them out of the fetch effect's
  // dependencies: keying the fetch on their identity would re-run it on every
  // render, and its dispatch would render again — an unbreakable loop. The
  // fetch is keyed on `id`/`reloadToken`, which is what actually selects a
  // record.
  const ucRef = useRef(uc);
  const ctxRef = useRef(ctx);

  // Refs may not be written during render; this runs before the fetch effect
  // below (effects fire in declaration order), so it always sees the latest.
  useEffect(() => {
    ucRef.current = uc;
    ctxRef.current = ctx;
  });

  useEffect(() => {
    if (id == null) {
      return;
    }

    // Guards against a slow response for a previous id landing after a newer one.
    let active = true;
    dispatch({ set: { isLoading: true, error: undefined } });

    Effect.runPromise(
      Effect.provide(ucRef.current, ctxRef.current.pipe(Context.add(EntityIdTag, id)))
    )
      .then(entity => {
        if (active) {
          dispatch({ set: { entity, isLoading: false } });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          dispatch({ set: { error: error as EntifixError, isLoading: false } });
        }
      });

    return () => {
      active = false;
    };
  }, [id, reloadToken]);

  const reload = useCallback(() => setReloadToken(token => token + 1), []);

  /** Replaces the held record, e.g. with the entity a save returned. */
  const setEntity = useCallback(
    (entity: TEntity | undefined) => dispatch({ set: { entity } }),
    []
  );

  return { ...state, reload, setEntity };
}
