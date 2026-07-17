import { EntityIdTag, EntityTag } from '@r10c/entifix-ts-business';
import { EntifixError, type Entity, type EntityId } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import { useCallback, useReducer } from 'react';

import type {
  UseEntityMutationAction,
  UseEntityMutationOptions,
  UseEntityMutationState,
} from './use-entity-mutation.types';

const initialState: UseEntityMutationState = {
  isSaving: false,
  isDeleting: false,
  error: undefined,
};

function reducer(
  state: UseEntityMutationState,
  action: UseEntityMutationAction
): UseEntityMutationState {
  return { ...state, ...action.set };
}

/**
 * Runs the write use-cases from a component — the mutating counterpart to
 * {@link useDataLoading}.
 *
 * Inputs are provided as tags at call time ({@link EntityTag} for a save,
 * {@link EntityIdTag} for a delete), so the use-cases stay unaware of both React
 * and the transport behind `ctx`.
 *
 * `save` resolves to the entity the *repository* returned rather than the one
 * passed in. That distinction matters: a create round-trips through the store's
 * id generation, so only the returned entity is addressable.
 */
export function useEntityMutation<TEntity extends Entity, TContext>({
  saveUc,
  deleteUc,
  ctx,
}: UseEntityMutationOptions<TEntity, TContext>) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const save = useCallback(
    async (entity: TEntity): Promise<TEntity | undefined> => {
      dispatch({ set: { isSaving: true, error: undefined } });
      try {
        const saved = await Effect.runPromise(
          Effect.provide(saveUc, ctx.pipe(Context.add(EntityTag, entity)))
        );
        dispatch({ set: { isSaving: false } });
        return saved;
      } catch (error) {
        dispatch({ set: { isSaving: false, error: error as EntifixError } });
        return undefined;
      }
    },
    [saveUc, ctx]
  );

  const remove = useCallback(
    async (id: EntityId): Promise<boolean> => {
      dispatch({ set: { isDeleting: true, error: undefined } });
      try {
        await Effect.runPromise(
          Effect.provide(deleteUc, ctx.pipe(Context.add(EntityIdTag, id)))
        );
        dispatch({ set: { isDeleting: false } });
        return true;
      } catch (error) {
        dispatch({ set: { isDeleting: false, error: error as EntifixError } });
        return false;
      }
    },
    [deleteUc, ctx]
  );

  return { ...state, save, remove };
}
