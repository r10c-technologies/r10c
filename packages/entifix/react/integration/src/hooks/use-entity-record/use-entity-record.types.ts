import { EntityIdTag } from '@r10c/entifix-ts-business';
import { EntifixError, Entity, EntityId } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

export interface UseEntityRecordState<TEntity extends Entity> {
  entity: TEntity | undefined;
  isLoading: boolean;
  error: EntifixError | undefined;
}

export type UseEntityRecordAction<TEntity extends Entity> = {
  set: Partial<UseEntityRecordState<TEntity>>;
};

export interface UseEntityRecordOptions<TEntity extends Entity, TContext> {
  /** A get use-case; the hook supplies {@link EntityIdTag}. */
  uc: Effect.Effect<TEntity, EntifixError, EntityIdTag | TContext>;
  ctx: Context.Context<TContext>;
  /**
   * The record to load. `undefined` means "nothing to load yet" — the create
   * case — and the hook stays idle rather than fetching.
   */
  id: EntityId;
}
