import { Failure } from '@entifix/core';
import { Schema } from 'effect';

import {
  CATEGORY_CYCLE,
  CATEGORY_HAS_CHILDREN,
  CATEGORY_PARENT_MISSING,
  CATEGORY_PARENT_RETIRED,
  CATEGORY_TOO_DEEP,
  type CategoryPlacementRefusal,
  type CategoryRetireRefusal,
} from '../values/category-tree';

/**
 * The rules a category tree keeps, as the failures a save answers with
 * ([ADR 0062](../../../../../../docs/adr/0062-categories-form-a-tree.md)).
 * Each names the category by what an operator typed, since a new one has no
 * id yet. A parent that is not there, a loop and a sixth level are wrong as
 * written; a retired parent and an active child are the tree as it stands.
 */
const named = { name: Schema.String };

export class CategoryParentMissing extends Failure.invalid<CategoryParentMissing>()(
  'CategoryParentMissing',
  CATEGORY_PARENT_MISSING,
  named,
  { message: ({ name }) => `"${name}" names a parent that does not exist` },
) {}

export class CategoryParentRetired extends Failure.conflict<CategoryParentRetired>()(
  'CategoryParentRetired',
  CATEGORY_PARENT_RETIRED,
  named,
  {
    message: ({ name }) => `"${name}" would sit active under a retired parent`,
  },
) {}

export class CategoryCycle extends Failure.invalid<CategoryCycle>()(
  'CategoryCycle',
  CATEGORY_CYCLE,
  named,
  { message: ({ name }) => `"${name}" would sit under its own subtree` },
) {}

export class CategoryTooDeep extends Failure.invalid<CategoryTooDeep>()(
  'CategoryTooDeep',
  CATEGORY_TOO_DEEP,
  named,
  {
    message: ({ name }) =>
      `"${name}" would make the tree deeper than it may be`,
  },
) {}

/**
 * Retiring a category that still has an active child is refused rather than
 * cascaded: a cascade would retire categories the operator never looked at.
 */
export class CategoryHasActiveChildren extends Failure.conflict<CategoryHasActiveChildren>()(
  'CategoryHasActiveChildren',
  CATEGORY_HAS_CHILDREN,
  named,
  { message: ({ name }) => `"${name}" still has an active child` },
) {}

export type CategoryRefusal =
  | CategoryParentMissing
  | CategoryParentRetired
  | CategoryCycle
  | CategoryTooDeep
  | CategoryHasActiveChildren;

const REFUSALS = {
  [CATEGORY_PARENT_MISSING]: CategoryParentMissing,
  [CATEGORY_PARENT_RETIRED]: CategoryParentRetired,
  [CATEGORY_CYCLE]: CategoryCycle,
  [CATEGORY_TOO_DEEP]: CategoryTooDeep,
  [CATEGORY_HAS_CHILDREN]: CategoryHasActiveChildren,
} as const;

/** The failure a tree rule's code stands for, naming the category. */
export const categoryRefusal = (
  code: CategoryPlacementRefusal | CategoryRetireRefusal,
  name: string,
): CategoryRefusal => new REFUSALS[code]({ name });
