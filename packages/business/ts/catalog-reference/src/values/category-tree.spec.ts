import { describe, expect, it } from 'vitest';

import { ProductCategory } from '../entities/product-category/index.js';
import {
  CATEGORY_CYCLE,
  CATEGORY_HAS_CHILDREN,
  CATEGORY_PARENT_MISSING,
  CATEGORY_PARENT_RETIRED,
  CATEGORY_TOO_DEEP,
  categoryPlacementRefusal,
  categoryRetireGuard,
  categorySaveRefusal,
  categorySubtree,
} from './category-tree.js';

const category = (
  id: string | undefined,
  parentId?: string,
  status: 'active' | 'retired' = 'active',
) => {
  const one = new ProductCategory(id ?? 'new', id ?? 'New');
  if (id !== undefined) one.id = id;
  one.parentId = parentId;
  one.status = status;
  return one;
};

//   home ── lighting ── desk
//   garden (retired)
const TREE = [
  category('home'),
  category('lighting', 'home'),
  category('desk', 'lighting'),
  category('garden', undefined, 'retired'),
];

/** A chain `c1 › c2 › … › cN`, for the depth cap. */
const chain = (length: number) =>
  Array.from({ length }, (_, index) =>
    category(`c${index + 1}`, index === 0 ? undefined : `c${index}`),
  );

describe('categoryPlacementRefusal', () => {
  it('accepts a root, and a category under an active parent', () => {
    expect(categoryPlacementRefusal(TREE, category(undefined))).toBeUndefined();
    expect(
      categoryPlacementRefusal(TREE, category(undefined, 'desk')),
    ).toBeUndefined();
  });

  it('reads an empty parent as a root', () => {
    expect(categoryPlacementRefusal(TREE, category('x', ''))).toBeUndefined();
  });

  it('refuses a parent that does not exist', () => {
    expect(categoryPlacementRefusal(TREE, category('x', 'gone'))).toBe(
      CATEGORY_PARENT_MISSING,
    );
  });

  it('refuses an active category under a retired parent', () => {
    expect(categoryPlacementRefusal(TREE, category('x', 'garden'))).toBe(
      CATEGORY_PARENT_RETIRED,
    );
  });

  it('lets a retired category sit under a retired parent', () => {
    expect(
      categoryPlacementRefusal(TREE, category('x', 'garden', 'retired')),
    ).toBeUndefined();
  });

  it('refuses the category itself, or anything under it, as its parent', () => {
    expect(categoryPlacementRefusal(TREE, category('home', 'home'))).toBe(
      CATEGORY_CYCLE,
    );
    expect(categoryPlacementRefusal(TREE, category('home', 'desk'))).toBe(
      CATEGORY_CYCLE,
    );
  });

  it('allows five levels and refuses a sixth', () => {
    const five = chain(5);

    expect(
      categoryPlacementRefusal(chain(4), category(undefined, 'c4')),
    ).toBeUndefined();
    expect(categoryPlacementRefusal(five, category(undefined, 'c5'))).toBe(
      CATEGORY_TOO_DEEP,
    );
  });

  /** Moving a category moves its subtree, and the subtree's depth with it. */
  it('counts the subtree a category carries when it moves', () => {
    // c1 › c2 › c3, plus a three-level branch b1 › b2 › b3.
    const all = [
      ...chain(3),
      category('b1'),
      category('b2', 'b1'),
      category('b3', 'b2'),
    ];

    expect(categoryPlacementRefusal(all, category('b1', 'c2'))).toBeUndefined();
    expect(categoryPlacementRefusal(all, category('b1', 'c3'))).toBe(
      CATEGORY_TOO_DEEP,
    );
  });
});

describe('categoryRetireGuard', () => {
  it('refuses retiring a category with an active child', () => {
    const guard = categoryRetireGuard(TREE, ['lighting'], true);

    expect(guard(category('lighting', 'home'))).toBe(CATEGORY_HAS_CHILDREN);
    expect(
      categoryRetireGuard(TREE, ['desk'], true)(category('desk', 'lighting')),
    ).toBeUndefined();
  });

  it('retires a whole branch selected together', () => {
    const guard = categoryRetireGuard(TREE, ['lighting', 'desk'], true);

    expect(guard(category('lighting', 'home'))).toBeUndefined();
  });

  it('refuses restoring a category under a retired parent', () => {
    const all = [...TREE, category('roses', 'garden', 'retired')];

    expect(
      categoryRetireGuard(
        all,
        ['roses'],
        false,
      )(category('roses', 'garden', 'retired')),
    ).toBe(CATEGORY_PARENT_RETIRED);
    expect(
      categoryRetireGuard(
        all,
        ['roses', 'garden'],
        false,
      )(category('roses', 'garden', 'retired')),
    ).toBeUndefined();
  });

  it('restores a root, or a category whose parent is gone', () => {
    const guard = categoryRetireGuard(TREE, ['garden'], false);

    expect(guard(category('garden', undefined, 'retired'))).toBeUndefined();
    expect(guard(category('x', 'gone', 'retired'))).toBeUndefined();
  });
});

describe('categorySaveRefusal', () => {
  it('refuses a save that retires a category with an active child', () => {
    expect(
      categorySaveRefusal(TREE, category('lighting', 'home', 'retired')),
    ).toBe(CATEGORY_HAS_CHILDREN);
  });

  it('retires a leaf, and saves an active category, as before', () => {
    expect(
      categorySaveRefusal(TREE, category('desk', 'lighting', 'retired')),
    ).toBeUndefined();
    expect(
      categorySaveRefusal(TREE, category('lighting', 'home')),
    ).toBeUndefined();
  });

  it('refuses a placement first', () => {
    expect(
      categorySaveRefusal(TREE, category('lighting', 'gone', 'retired')),
    ).toBe(CATEGORY_PARENT_MISSING);
  });

  it('has nothing to retire out from under on a new category', () => {
    const fresh = new ProductCategory('new', 'New');
    fresh.status = 'retired';

    expect(categorySaveRefusal(TREE, fresh)).toBeUndefined();
  });
});

describe('categorySubtree', () => {
  it('is the category and every active category under it', () => {
    const all = [...TREE, category('old', 'lighting', 'retired')];

    expect(categorySubtree(all, 'home').sort()).toEqual(
      ['desk', 'home', 'lighting'].sort(),
    );
    expect(categorySubtree(all, 'desk')).toEqual(['desk']);
  });
});
