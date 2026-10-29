import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_CYCLE,
  CATEGORY_HAS_CHILDREN,
  CATEGORY_PARENT_MISSING,
  CATEGORY_PARENT_RETIRED,
  CATEGORY_TOO_DEEP,
} from '../values/category-tree.js';
import { categoryRefusal } from './category-failures.js';

describe('categoryRefusal', () => {
  it('answers each tree rule as its own failure, with the code the catalog renders', () => {
    const refusals = (
      [
        CATEGORY_PARENT_MISSING,
        CATEGORY_PARENT_RETIRED,
        CATEGORY_CYCLE,
        CATEGORY_TOO_DEEP,
        CATEGORY_HAS_CHILDREN,
      ] as const
    ).map(code => categoryRefusal(code, 'Tazas'));

    expect(refusals.every(isFailure)).toBe(true);
    expect(
      refusals.map(refusal => [refusal._tag, refusal.code, refusal.category]),
    ).toEqual([
      ['CategoryParentMissing', 'categoryParentMissing', 'invalid'],
      ['CategoryParentRetired', 'categoryParentRetired', 'conflict'],
      ['CategoryCycle', 'categoryCycle', 'invalid'],
      ['CategoryTooDeep', 'categoryTooDeep', 'invalid'],
      ['CategoryHasActiveChildren', 'categoryHasChildren', 'conflict'],
    ]);
    expect(refusals.map(refusal => refusal.message)).toEqual([
      '"Tazas" names a parent that does not exist',
      '"Tazas" would sit active under a retired parent',
      '"Tazas" would sit under its own subtree',
      '"Tazas" would make the tree deeper than it may be',
      '"Tazas" still has an active child',
    ]);
  });
});
