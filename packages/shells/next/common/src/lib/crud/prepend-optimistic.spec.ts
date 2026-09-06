import type { Entity, EntityPage } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { prependOptimistic } from './prepend-optimistic.js';

const record = (id: string): Entity => ({ id }) as Entity;

const page = (items: Entity[], total: number): EntityPage<Entity> => ({
  items,
  total,
  request: {},
});

describe('prependOptimistic', () => {
  it('puts the new record first and moves the total with it', () => {
    const patched = prependOptimistic(record('new'))(
      page([record('a'), record('b')], 7),
    );

    expect(patched?.items.map(item => item.id)).toEqual(['new', 'a', 'b']);
    expect(patched?.total).toBe(8);
  });

  // `setQueriesData` hands the updater `undefined` for a query that is in the
  // cache but has not resolved — the list still loading when a save lands.
  // There is no page to prepend to, and inventing one would render a list of
  // exactly one record over whatever the fetch is about to return.
  it('leaves an unresolved query alone', () => {
    expect(prependOptimistic(record('new'))(undefined)).toBeUndefined();
  });

  it('does not mutate the page it was given', () => {
    const original = page([record('a')], 1);

    prependOptimistic(record('new'))(original);

    expect(original.items.map(item => item.id)).toEqual(['a']);
    expect(original.total).toBe(1);
  });
});
