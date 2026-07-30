import type { Entity, FilterGroup } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { combineFilterGroups } from './combine-filtering.js';

interface Widget extends Entity {
  name: string;
}

const group = (name: string): FilterGroup<Widget> => ({
  operator: 'and',
  values: [{ property: 'name', operator: 'like', value: name }],
});

const empty: FilterGroup<Widget> = { operator: 'and', values: [] };

describe('combineFilterGroups', () => {
  it('is nothing when there is nothing to say', () => {
    expect(combineFilterGroups<Widget>(undefined, undefined)).toBeUndefined();
  });

  // An empty group matches everything, so carrying it would send a filter that
  // narrows nothing — and change the cache key while doing it.
  it('drops a group with no values', () => {
    expect(combineFilterGroups<Widget>(empty, undefined)).toBeUndefined();
  });

  it('returns a lone group unwrapped', () => {
    const only = group('acme');

    expect(combineFilterGroups<Widget>(undefined, only)).toBe(only);
  });

  it('ANDs the groups that say something', () => {
    const left = group('acme');
    const right = group('globex');

    expect(combineFilterGroups<Widget>(left, empty, right)).toEqual({
      operator: 'and',
      values: [left, right],
    });
  });
});
