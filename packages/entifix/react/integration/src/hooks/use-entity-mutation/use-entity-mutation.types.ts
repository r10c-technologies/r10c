import { EntityIdTag, EntityTag } from '@entifix/business';
import { EntifixError, Entity } from '@entifix/core';
import { Context, Effect } from 'effect';

export interface UseEntityMutationState {
  isSaving: boolean;
  isDeleting: boolean;
  error: EntifixError | undefined;
}

export type UseEntityMutationAction = {
  set: Partial<UseEntityMutationState>;
};

export interface UseEntityMutationOptions<TEntity extends Entity, TContext> {
  /** A save use-case; the hook supplies {@link EntityTag}. */
  saveUc: Effect.Effect<TEntity, EntifixError, EntityTag | TContext>;
  /** A delete use-case; the hook supplies {@link EntityIdTag}. */
  deleteUc: Effect.Effect<void, EntifixError, EntityIdTag | TContext>;
  ctx: Context.Context<TContext>;
}
