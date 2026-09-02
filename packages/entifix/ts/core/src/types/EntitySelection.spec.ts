import { describe, expect, it } from 'vitest';

import type { Entity, EntityId } from './Entity.js';
import {
  emptySelection,
  type EntitySelection,
  isSelected,
  isSelectionEmpty,
  readWireSelection,
  selectionIds,
  selectionSize,
  toggleSelected,
  toWireSelection,
} from './EntitySelection.js';

interface Widget extends Entity {
  name?: string;
}

const ids = (...values: EntityId[]): EntitySelection<Widget> => ({
  mode: 'ids',
  ids: new Set(values),
});

const matching = (
  total: number,
  ...excluded: EntityId[]
): EntitySelection<Widget> => ({
  mode: 'matching',
  total,
  excluded: new Set(excluded),
});

describe('emptySelection', () => {
  it('starts in ids mode holding nothing', () => {
    const selection = emptySelection<Widget>();

    expect(selection.mode).toBe('ids');
    expect(isSelectionEmpty(selection)).toBe(true);
  });
});

describe('selectionSize', () => {
  it('counts the ids in ids mode', () => {
    expect(selectionSize(ids('a', 'b'))).toBe(2);
  });

  it('subtracts the exclusions from the server count in matching mode', () => {
    expect(selectionSize(matching(3200, 'a', 'b'))).toBe(3198);
  });

  /**
   * The count is the server's and the exclusions are the browser's, so the two
   * can disagree after a concurrent write. Clamping is what stops a
   * confirmation reading "Retirar -1 marcas".
   */
  it('never reports a negative count', () => {
    expect(selectionSize(matching(1, 'a', 'b'))).toBe(0);
  });
});

describe('isSelected', () => {
  it('reads membership in ids mode', () => {
    expect(isSelected(ids('a'), 'a')).toBe(true);
    expect(isSelected(ids('a'), 'b')).toBe(false);
  });

  /** In matching mode every row is in unless it was taken out. */
  it('reads absence from the exclusions in matching mode', () => {
    expect(isSelected(matching(10, 'a'), 'b')).toBe(true);
    expect(isSelected(matching(10, 'a'), 'a')).toBe(false);
  });
});

describe('isSelectionEmpty', () => {
  it('is true only when nothing would be touched', () => {
    expect(isSelectionEmpty(ids())).toBe(true);
    expect(isSelectionEmpty(ids('a'))).toBe(false);
    expect(isSelectionEmpty(matching(2, 'a', 'b'))).toBe(true);
    expect(isSelectionEmpty(matching(2, 'a'))).toBe(false);
  });
});

describe('toggleSelected', () => {
  it('adds and removes ids in ids mode', () => {
    expect(selectionIds(toggleSelected(ids(), 'a', true))).toEqual(['a']);
    expect(selectionIds(toggleSelected(ids('a'), 'a', false))).toEqual([]);
  });

  /**
   * The inverse direction, and the reason the two modes are one function: in
   * matching mode the browser owns only what was taken back out of the
   * server's answer, so selecting a row *removes* an exclusion.
   */
  it('writes the exclusions in matching mode', () => {
    const deselected = toggleSelected(matching(10), 'a', false);
    expect(isSelected(deselected, 'a')).toBe(false);

    const reselected = toggleSelected(deselected, 'a', true);
    expect(isSelected(reselected, 'a')).toBe(true);
  });

  it('returns a new value rather than mutating', () => {
    const before = ids('a');
    const after = toggleSelected(before, 'b', true);

    expect(after).not.toBe(before);
    expect(selectionSize(before)).toBe(1);
  });

  it('preserves the filtering and total across a matching toggle', () => {
    const before: EntitySelection<Widget> = {
      mode: 'matching',
      total: 42,
      excluded: new Set(),
      filtering: { operator: 'and', values: [] },
    };

    const after = toggleSelected(before, 'a', false);

    expect(after).toMatchObject({ mode: 'matching', total: 42 });
    expect(after.mode === 'matching' && after.filtering).toEqual({
      operator: 'and',
      values: [],
    });
  });
});

describe('selectionIds', () => {
  it('lists the ids in ids mode', () => {
    expect(selectionIds(ids('a', 'b'))).toEqual(['a', 'b']);
  });

  /**
   * `undefined`, never `[]`: an empty array is a plausible request body and
   * would silently act on nothing, where `undefined` cannot be sent at all and
   * forces the caller to send the filter instead.
   */
  it('refuses to enumerate a matching selection', () => {
    expect(selectionIds(matching(3200))).toBeUndefined();
  });
});

/**
 * A `Set` serializes to `{}`. Silently. A `matching` selection whose exclusions
 * evaporate on the wire acts on rows the operator deliberately took out, so
 * the two shapes are named separately rather than one used loosely.
 */
describe('the wire form', () => {
  /**
   * The regression this file exists to hold, and the reason it asserts the
   * *members* rather than only the length.
   *
   * Every package here compiles with `"loose": true`, and SWC's loose spread
   * helper skips the iterable protocol: it looks for `length`, does not find
   * one on a `Set`, and wraps it as a single element. `[...someSet]` becomes
   * `[Set]` — silently, and with the correct `.size` still sitting on the
   * inner value. Vitest and Turbopack transpile differently, so a spread
   * passes every unit test here and fails only in the built service bundle,
   * where it turned a two-row selection into one outcome whose `id`
   * serialized as `{}`.
   *
   * An assertion on `.length` alone would not have caught it either: the
   * wrapped form is length 1 for a one-row selection.
   */
  it('carries the ids themselves, not the set that held them', () => {
    const wire = toWireSelection(ids('a', 'b'));

    expect(wire).toEqual({ mode: 'ids', ids: ['a', 'b'] });
    expect(
      wire.mode === 'ids' && wire.ids.every(id => typeof id === 'string'),
    ).toBe(true);
  });

  it('carries the exclusions themselves too', () => {
    const wire = toWireSelection<Widget>(matching(10, 'a'));

    expect(wire).toEqual({
      mode: 'matching',
      total: 10,
      excluded: ['a'],
      filtering: undefined,
    });
  });

  it('does not survive JSON as a set — which is why this exists', () => {
    expect(JSON.parse(JSON.stringify(ids('a', 'b')))).toEqual({
      mode: 'ids',
      ids: {},
    });
  });

  it('round-trips an ids selection', () => {
    const wire = JSON.parse(JSON.stringify(toWireSelection(ids('a', 'b'))));

    expect(readWireSelection<Widget>(wire)).toEqual(ids('a', 'b'));
  });

  it('round-trips a matching selection, exclusions and all', () => {
    const before: EntitySelection<Widget> = {
      mode: 'matching',
      total: 3200,
      excluded: new Set(['a']),
      filtering: { operator: 'and', values: [] },
    };

    const wire = JSON.parse(JSON.stringify(toWireSelection(before)));

    expect(readWireSelection<Widget>(wire)).toEqual(before);
  });

  it('carries no filtering when none was applied', () => {
    const wire = toWireSelection<Widget>(matching(10));

    expect(readWireSelection<Widget>(wire)).toEqual(matching(10));
  });

  /**
   * Untrusted input decides which rows a bulk write touches, so an unreadable
   * body is rejected rather than defaulted. Defaulting to `ids` would act on
   * nothing; defaulting to `matching` would act on everything.
   */
  it.each([
    ['null', null],
    ['a string', 'ids'],
    ['no mode', { ids: ['a'] }],
    ['an unknown mode', { mode: 'all' }],
    ['ids that are not an array', { mode: 'ids', ids: {} }],
    ['matching with no total', { mode: 'matching', excluded: [] }],
    ['matching with no exclusions array', { mode: 'matching', total: 3 }],
  ])('refuses %s', (_name, value) => {
    expect(readWireSelection<Widget>(value)).toBeUndefined();
  });
});
