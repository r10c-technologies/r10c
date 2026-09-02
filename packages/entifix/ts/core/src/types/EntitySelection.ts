import type { Entity, EntityId } from './Entity';
import type { FilterGroup } from './EntityFiltering';

/**
 * What a collection-bound action acts on.
 *
 * The two members are **not** two shapes of one idea, and collapsing them is
 * the defect this type exists to prevent. "Select all on this page" is a list
 * of ids the browser already holds; "select all 3.200 matching the filter" is a
 * *filter expression the server evaluates* — the set is by definition larger
 * than the page, so there is nothing to enumerate. Written as one optional
 * field (`ids?: …` beside `all?: boolean`) the second quietly becomes the
 * first, and a bulk action that reads as "the 25 rows I can see" runs over
 * every row in the store.
 *
 * `excluded` is what makes the second member usable rather than all-or-nothing:
 * an operator takes everything matching and then drops the two rows they know
 * about. It is a subtraction from a server-side set, never an addition to a
 * client-side one.
 *
 * `total` is carried rather than derived because only the server knows it, and
 * the count is the whole affordance — "Retirar 3.200 marcas" is a different
 * sentence from "Retirar", and the user has to read the number *before* they
 * confirm ([ADR 0035](../../../../../../docs/adr/0035-entity-actions-selection-and-bulk.md)).
 */
export type EntitySelection<TEntity extends Entity> =
  | {
      mode: 'ids';
      ids: ReadonlySet<EntityId>;
    }
  | {
      mode: 'matching';
      /** The filtering in effect when the set was taken. Absent means "every row". */
      filtering?: FilterGroup<TEntity>;
      /** How many rows the server said match. */
      total: number;
      /** Rows the user removed from the matching set. */
      excluded: ReadonlySet<EntityId>;
    };

/** An empty `ids` selection — the state a table starts and clears to. */
export const emptySelection = <
  TEntity extends Entity,
>(): EntitySelection<TEntity> => ({ mode: 'ids', ids: new Set<EntityId>() });

/**
 * How many rows the action will touch.
 *
 * For `matching` this is the server's count minus what the user removed, which
 * is the number the confirmation must show. It can only ever be an estimate —
 * rows may have been written since the count was taken — and that is inherent
 * to the mode rather than a defect in it.
 */
export function selectionSize<TEntity extends Entity>(
  selection: EntitySelection<TEntity>,
): number {
  return selection.mode === 'ids'
    ? selection.ids.size
    : Math.max(0, selection.total - selection.excluded.size);
}

/** Whether one row is part of the selection. */
export function isSelected<TEntity extends Entity>(
  selection: EntitySelection<TEntity>,
  id: EntityId,
): boolean {
  return selection.mode === 'ids'
    ? selection.ids.has(id)
    : !selection.excluded.has(id);
}

/** Whether the action would touch nothing. */
export function isSelectionEmpty<TEntity extends Entity>(
  selection: EntitySelection<TEntity>,
): boolean {
  return selectionSize(selection) === 0;
}

/**
 * Add or remove one row, in whichever direction the current mode means.
 *
 * In `ids` mode a toggle writes the id set; in `matching` mode it writes the
 * *exclusion* set, because the selection is the server's answer and the only
 * thing the browser owns is what was taken back out of it. Both return a new
 * value — the selection is controlled state held above the table.
 */
export function toggleSelected<TEntity extends Entity>(
  selection: EntitySelection<TEntity>,
  id: EntityId,
  selected: boolean,
): EntitySelection<TEntity> {
  if (selection.mode === 'ids') {
    const ids = new Set(selection.ids);
    if (selected) ids.add(id);
    else ids.delete(id);
    return { mode: 'ids', ids };
  }

  const excluded = new Set(selection.excluded);
  if (selected) excluded.delete(id);
  else excluded.add(id);
  return { ...selection, excluded };
}

/**
 * The ids a bulk request should carry, or `undefined` when it must carry the
 * filter instead.
 *
 * A caller that treats `undefined` as "no rows" has made exactly the mistake
 * the two modes exist to prevent, so this returns `undefined` rather than an
 * empty array: an empty array is a plausible payload and would silently do
 * nothing, where `undefined` cannot be sent at all.
 */
export function selectionIds<TEntity extends Entity>(
  selection: EntitySelection<TEntity>,
): EntityId[] | undefined {
  return selection.mode === 'ids' ? Array.from(selection.ids) : undefined;
}

/**
 * The selection as it crosses the wire.
 *
 * `Set` does not survive `JSON.stringify` — it serializes to `{}`, silently,
 * and arrives as an empty object that reads as "no rows excluded" rather than
 * as an error. That is the same class of fault ADR 0032 recorded for autosaved
 * drafts, and it is worse here: a `matching` selection whose exclusions
 * evaporate acts on rows the operator deliberately took out.
 *
 * So the wire form is arrays and the in-memory form is sets, named separately
 * rather than one type used loosely. The set is the right in-memory shape
 * because it dedupes by construction and answers `isSelected` in constant time;
 * the array is the only JSON shape there is.
 */
export type EntitySelectionWire<TEntity extends Entity> =
  | { mode: 'ids'; ids: EntityId[] }
  | {
      mode: 'matching';
      filtering?: FilterGroup<TEntity>;
      total: number;
      excluded: EntityId[];
    };

/**
 * Convert a selection to its wire form.
 *
 * ⚠️ **`Array.from(set)`, never `[...set]`.** Every package here compiles with
 * `"loose": true` in its `.swcrc`, and SWC's loose spread helper skips the
 * iterable protocol: it treats the operand as array-like, finds no `length` on
 * a `Set`, and **wraps it as a single element** — `[...someSet]` becomes
 * `[Set]`, silently, with the right `.size` still on the inner value. Measured
 * against the running service, where it turned a two-row selection into one
 * outcome whose `id` serialized as `{}`. Vitest and Turbopack transpile
 * differently, so it passes every unit test and only fails in the built
 * bundle.
 */
export function toWireSelection<TEntity extends Entity>(
  selection: EntitySelection<TEntity>,
): EntitySelectionWire<TEntity> {
  return selection.mode === 'ids'
    ? { mode: 'ids', ids: Array.from(selection.ids) }
    : { ...selection, excluded: Array.from(selection.excluded) };
}

/**
 * Read a wire selection back, rejecting anything that is not one.
 *
 * Untrusted input: this arrives in a request body and decides which rows a
 * bulk write touches. A missing `mode` must not fall through to a default —
 * defaulting to `ids` with no ids would act on nothing (merely confusing),
 * while defaulting to `matching` would act on **everything**.
 */
export function readWireSelection<TEntity extends Entity>(
  value: unknown,
): EntitySelection<TEntity> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<EntitySelectionWire<TEntity>>;

  if (candidate.mode === 'ids') {
    return Array.isArray(candidate.ids)
      ? { mode: 'ids', ids: new Set(candidate.ids) }
      : undefined;
  }

  if (candidate.mode === 'matching') {
    const matching = candidate as Extract<
      EntitySelectionWire<TEntity>,
      { mode: 'matching' }
    >;
    if (typeof matching.total !== 'number') return undefined;
    if (!Array.isArray(matching.excluded)) return undefined;
    return {
      mode: 'matching',
      filtering: matching.filtering,
      total: matching.total,
      excluded: new Set(matching.excluded),
    };
  }

  return undefined;
}
