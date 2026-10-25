import {
  depthOf,
  descendantsOf,
  type EntityId,
  type HierarchyKeys,
  wouldCycle,
} from '@entifix/core';

import type { ProductCategory } from '../entities/product-category';

/**
 * The rules a category tree keeps
 * ([ADR 0062](../../../../../../docs/adr/0062-categories-form-a-tree.md)).
 *
 * Pure: each takes the whole vocabulary, which is small and read in one
 * request anyway, and answers a code or `undefined`. The routes load the
 * vocabulary and turn a code into a `409`; the codes are in both `errors`
 * catalogs, because `@r10c/i18n-check` fails the build on one that is not.
 */

/** No browse tree people navigate by hand is deeper; the cap bounds every walk. */
export const MAX_CATEGORY_DEPTH = 5;

export const CATEGORY_PARENT_MISSING = 'categoryParentMissing';
export const CATEGORY_PARENT_RETIRED = 'categoryParentRetired';
export const CATEGORY_CYCLE = 'categoryCycle';
export const CATEGORY_TOO_DEEP = 'categoryTooDeep';
export const CATEGORY_HAS_CHILDREN = 'categoryHasChildren';

export type CategoryPlacementRefusal =
  | typeof CATEGORY_PARENT_MISSING
  | typeof CATEGORY_PARENT_RETIRED
  | typeof CATEGORY_CYCLE
  | typeof CATEGORY_TOO_DEEP;

export type CategoryRetireRefusal =
  typeof CATEGORY_HAS_CHILDREN | typeof CATEGORY_PARENT_RETIRED;

/** How a category names itself and its parent, for entifix's tree helpers. */
export const CATEGORY_KEYS: HierarchyKeys<ProductCategory> = {
  idOf: category => String(category.id ?? ''),
  parentOf: category => category.parentId,
};

const parentOf = (category: ProductCategory) =>
  category.parentId === undefined || category.parentId === ''
    ? undefined
    : category.parentId;

/**
 * How many levels a category's subtree adds below it: 0 for a leaf. Measured
 * on the stored tree, so moving a category moves its whole subtree's depth.
 */
const subtreeHeight = (
  all: readonly ProductCategory[],
  key: string,
): number => {
  const own = depthOf(all, CATEGORY_KEYS, key);
  return descendantsOf(all, CATEGORY_KEYS, key).reduce(
    (height, descendant) =>
      Math.max(height, depthOf(all, CATEGORY_KEYS, descendant) - own),
    0,
  );
};

/**
 * Why `candidate` may not be saved where it says it sits, or `undefined`.
 *
 * `all` is the stored vocabulary; the candidate replaces its own stored row,
 * if it has one, before anything is measured. The order of the checks is the
 * order an operator can act on: a parent that is not there, then one that is
 * retired, then a loop, then the depth.
 */
export function categoryPlacementRefusal(
  all: readonly ProductCategory[],
  candidate: ProductCategory,
): CategoryPlacementRefusal | undefined {
  const parent = parentOf(candidate);
  if (parent === undefined) return undefined;

  const key = CATEGORY_KEYS.idOf(candidate);
  const tree = [
    ...all.filter(category => CATEGORY_KEYS.idOf(category) !== key),
    candidate,
  ];

  const parentRow = tree.find(
    category => CATEGORY_KEYS.idOf(category) === parent,
  );
  if (parentRow === undefined) return CATEGORY_PARENT_MISSING;
  // An active category under a retired one would be browsable from nowhere.
  if (parentRow.status === 'retired' && candidate.status === 'active') {
    return CATEGORY_PARENT_RETIRED;
  }
  if (key !== '' && wouldCycle(all, CATEGORY_KEYS, key, parent)) {
    return CATEGORY_CYCLE;
  }

  const depth = depthOf(tree, CATEGORY_KEYS, parent) + 1;
  const height = key === '' ? 0 : subtreeHeight(all, key);
  return depth + height > MAX_CATEGORY_DEPTH ? CATEGORY_TOO_DEEP : undefined;
}

/**
 * The guard a retire or restore run applies to each row.
 *
 * Retiring a category that still has an active child is refused rather than
 * cascaded: a cascade would retire categories the operator never looked at,
 * each with its own offerings. Restoring one whose parent is retired is
 * refused for the reason a save refuses it. A row whose child (or parent) is
 * in the same selection is judged as if that row had already moved, so
 * retiring a whole branch in one run works.
 */
export function categoryRetireGuard(
  all: readonly ProductCategory[],
  selection: readonly EntityId[],
  retired: boolean,
): (category: ProductCategory) => CategoryRetireRefusal | undefined {
  const selected = new Set(selection.map(String));
  const target = retired ? 'retired' : 'active';
  const statusOf = (category: ProductCategory) =>
    selected.has(CATEGORY_KEYS.idOf(category)) ? target : category.status;

  return category => {
    const key = CATEGORY_KEYS.idOf(category);
    if (retired) {
      const activeChild = all.some(
        other => parentOf(other) === key && statusOf(other) === 'active',
      );
      return activeChild ? CATEGORY_HAS_CHILDREN : undefined;
    }
    const parent = parentOf(category);
    const parentRow =
      parent === undefined
        ? undefined
        : all.find(other => CATEGORY_KEYS.idOf(other) === parent);
    return parentRow !== undefined && statusOf(parentRow) === 'retired'
      ? CATEGORY_PARENT_RETIRED
      : undefined;
  };
}

/**
 * Why a save of `candidate` must be refused, or `undefined`: everything
 * {@link categoryPlacementRefusal} checks, and — when the save retires the
 * category — the rule the retire verb applies, that no active child is left
 * under it.
 *
 * ⚠️ The edit form writes `status` as a plain field, so a save is a second way
 * to retire. Guarding only the verb left that way open: the live pass on
 * 2026-10-25 retired a root with two active children through a `PUT`.
 */
export function categorySaveRefusal(
  all: readonly ProductCategory[],
  candidate: ProductCategory,
): CategoryPlacementRefusal | CategoryRetireRefusal | undefined {
  const placement = categoryPlacementRefusal(all, candidate);
  if (placement !== undefined || candidate.status !== 'retired') {
    return placement;
  }
  const key = CATEGORY_KEYS.idOf(candidate);
  return key === ''
    ? undefined
    : categoryRetireGuard(all, [key], true)(candidate);
}

/**
 * A category and every active category under it: what a category page lists
 * offerings from, as `categoryId in (…)`.
 */
export function categorySubtree(
  all: readonly ProductCategory[],
  key: string,
): string[] {
  const active = all.filter(category => category.status === 'active');
  return [key, ...descendantsOf(active, CATEGORY_KEYS, key)];
}
