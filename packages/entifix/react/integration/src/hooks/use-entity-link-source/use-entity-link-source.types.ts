import type { EntityIdTag, EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import type {
  EntifixError,
  Entity,
  EntityConstructor,
  EntityFieldDescriptor,
  EntityId,
  EntityPage,
  FilterGroup,
} from '@r10c/entifix-ts-core';
import type { Context, Effect } from 'effect';

/**
 * Where a picker's targets come from, and what may be picked.
 *
 * The use-cases are the parametrization seam: a domain that must restrict what is
 * assignable supplies its own list use-case (only active brands, only leaf
 * categories) instead of the generic `loadUCFactory`, and the picker never learns
 * the rule. {@link baseFiltering} is the lighter version of the same idea for a
 * restriction that needs no use-case of its own.
 */
export interface EntityLinkSourceConfig<
  TTarget extends Entity,
  TContext,
> {
  entityConstructor: EntityConstructor<TTarget>;
  /** Lists the targets. Supplies {@link EntityLoadRequestTag} per request. */
  loadUc: Effect.Effect<
    EntityPage<TTarget>,
    EntifixError,
    EntityLoadRequestTag | TContext
  >;
  /**
   * Loads one target by id — how a draft restored from storage turns its held
   * foreign key back into a name. Omit it and the input falls back to showing
   * the bare key.
   */
  getUc?: Effect.Effect<TTarget, EntifixError, EntityIdTag | TContext>;
  ctx: Context.Context<TContext>;
  /**
   * ANDed into every quick and browse request, so a caller can narrow the
   * selectable set without writing a use-case.
   */
  baseFiltering?: FilterGroup<TTarget>;
  /** How many suggestions the quick search asks for. Defaults to 10. */
  quickPageSize?: number;
  /** Milliseconds of quiet before a typed term is sent. Defaults to 250. */
  debounceMs?: number;
}

export interface UseEntityLinkSourceOptions<TTarget extends Entity> {
  /**
   * The relation being edited. Its `linkSearchProperty` is what the quick search
   * filters on and its `linkLabelProperty` is what a target reads as.
   */
  descriptor: EntityFieldDescriptor;
  /** The foreign key the draft currently holds. */
  selectedId?: EntityId;
  /**
   * The instance behind {@link selectedId} when the caller already has it — the
   * one the user just picked, or the one a loaded record carried. Present, it
   * spares the label request entirely.
   */
  selectedEntity?: TTarget;
}
