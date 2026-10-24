import { EntityRepositoryTag } from '@entifix/business';
import type { Entity } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  getBrand,
  getCategory,
  getCategoryByCode,
  loadBrands,
  loadCategories,
  loadCategoryChildren,
  loadCategoryRoots,
  loadCategorySubtree,
  loadCategoryTrail,
  VOCABULARY_PAGE_SIZE,
} from './vocabulary.js';

/**
 * These run the generic load use case over an in-memory repository, so what is
 * under test is the request each read builds and what it makes of the page —
 * never a transport. The wiring the storefront ships is the shell's spec.
 */

const brand = (id: string, name: string) => {
  const one = new ProductBrand(name);
  one.id = id;
  one.code = name.slice(0, 3).toUpperCase();
  return one;
};

const category = (id: string, code: string, name: string) => {
  const one = new ProductCategory(code, name);
  one.id = id;
  return one;
};

const BRANDS = [brand('brand-terra', 'Terra'), brand('brand-aurora', 'Aurora')];
const retired = <T extends { status: string }>(one: T): T => {
  one.status = 'retired';
  return one;
};

const BRANDS_WITH_RETIRED = [...BRANDS, retired(brand('brand-old', 'Olden'))];
const CATEGORIES = [
  category('category-tableware', 'vajilla', 'Vajilla'),
  category('category-lighting', 'iluminacion', 'Iluminación'),
];
const CATEGORIES_WITH_RETIRED = [
  ...CATEGORIES,
  retired(category('category-old', 'antiguo', 'Antiguo')),
];

const run = <A>(
  read: Effect.Effect<A, unknown, EntityRepositoryTag>,
  seed: Entity[],
) => {
  const repository = makeInMemoryEntityRepository(seed);
  const load = vi.spyOn(repository, 'load');
  const result = Effect.runPromise(
    read.pipe(
      Effect.provide(Context.make(EntityRepositoryTag, repository)),
    ) as Effect.Effect<A>,
  );
  return { result, load };
};

describe('loadCategories', () => {
  it('returns every category sorted by name, in one bounded read', async () => {
    const { result, load } = run(loadCategories(), CATEGORIES);

    expect((await result).items.map(item => item.name)).toEqual([
      'Iluminación',
      'Vajilla',
    ]);
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: VOCABULARY_PAGE_SIZE }),
    );
  });
});

describe('the retired vocabulary (#327)', () => {
  it('leaves a retired category out of the nav', async () => {
    const { result } = run(loadCategories(), CATEGORIES_WITH_RETIRED);

    expect((await result).items.map(item => item.code)).not.toContain(
      'antiguo',
    );
  });

  it('does not resolve a retired category’s route', async () => {
    const { result } = run(
      getCategoryByCode('antiguo'),
      CATEGORIES_WITH_RETIRED,
    );

    expect(await result).toBeUndefined();
  });

  /** Retiring keeps what already points at a record resolvable. */
  it('still names a retired brand or category an offering points at', async () => {
    expect(
      (await run(getBrand('brand-old'), BRANDS_WITH_RETIRED).result)?.name,
    ).toBe('Olden');
    expect(
      (await run(getCategory('category-old'), CATEGORIES_WITH_RETIRED).result)
        ?.name,
    ).toBe('Antiguo');
    expect(
      (await run(loadBrands(), BRANDS_WITH_RETIRED).result).items,
    ).toHaveLength(3);
  });
});

describe('loadBrands', () => {
  it('returns every brand sorted by name', async () => {
    const { result } = run(loadBrands(), BRANDS);

    expect((await result).items.map(item => item.name)).toEqual([
      'Aurora',
      'Terra',
    ]);
  });
});

describe('getCategoryByCode', () => {
  it('filters on code rather than scanning the vocabulary', async () => {
    const { result, load } = run(getCategoryByCode('vajilla'), CATEGORIES);

    expect((await result)?.id).toBe('category-tableware');
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        filtering: [
          { property: 'code', operator: 'eq', value: 'vajilla' },
          { property: 'status', operator: 'eq', value: 'active' },
        ],
        pageSize: 1,
      }),
    );
  });

  it('answers undefined for a code nobody authored', async () => {
    const { result } = run(getCategoryByCode('nope'), CATEGORIES);

    expect(await result).toBeUndefined();
  });
});

describe('getBrand and getCategory', () => {
  it('resolve the record an offering names', async () => {
    expect((await run(getBrand('brand-aurora'), BRANDS).result)?.name).toBe(
      'Aurora',
    );
    expect(
      (await run(getCategory('category-lighting'), CATEGORIES).result)?.name,
    ).toBe('Iluminación');
  });

  it('answer undefined for an id whose target is gone', async () => {
    expect(await run(getBrand('brand-gone'), BRANDS).result).toBeUndefined();
    expect(
      await run(getCategory('category-gone'), CATEGORIES).result,
    ).toBeUndefined();
  });

  it('short-circuit an unclassified offering without reading', async () => {
    const brandRead = run(getBrand(undefined), BRANDS);
    const categoryRead = run(getCategory(undefined), CATEGORIES);

    expect(await brandRead.result).toBeUndefined();
    expect(await categoryRead.result).toBeUndefined();
    expect(brandRead.load).not.toHaveBeenCalled();
    expect(categoryRead.load).not.toHaveBeenCalled();
  });
});

describe('the category tree (ADR 0062)', () => {
  const child = (id: string, code: string, parentId: string) => {
    const one = category(id, code, code);
    one.parentId = parentId;
    return one;
  };
  const TREE = [
    ...CATEGORIES,
    child('category-desk', 'escritorio', 'category-lighting'),
    child('category-lamp', 'lampara', 'category-desk'),
    retired(child('category-old', 'viejo', 'category-lighting')),
  ];

  it('puts only the roots in the nav', async () => {
    const { result } = run(loadCategoryRoots(), TREE);

    expect((await result).map(item => item.id).sort()).toEqual([
      'category-lighting',
      'category-tableware',
    ]);
  });

  it('lists a category with every active category under it', async () => {
    const { result } = run(loadCategorySubtree('category-lighting'), TREE);

    expect((await result).sort()).toEqual([
      'category-desk',
      'category-lamp',
      'category-lighting',
    ]);
  });

  it('trails a category back to its root, root first', async () => {
    const { result } = run(loadCategoryTrail('category-lamp'), TREE);

    expect((await result).map(item => item.id)).toEqual([
      'category-lighting',
      'category-desk',
      'category-lamp',
    ]);
  });

  it('still trails through a retired category an offering names', async () => {
    const { result } = run(loadCategoryTrail('category-old'), TREE);

    expect((await result).map(item => item.id)).toEqual([
      'category-lighting',
      'category-old',
    ]);
  });

  it('has no trail for an unclassified offering or an unknown id', async () => {
    const unclassified = run(loadCategoryTrail(undefined), TREE);
    expect(await unclassified.result).toEqual([]);
    expect(unclassified.load).not.toHaveBeenCalled();

    expect(await run(loadCategoryTrail('category-gone'), TREE).result).toEqual(
      [],
    );
  });

  it('offers a category’s active children, and none for a leaf', async () => {
    const { result } = run(loadCategoryChildren('category-lighting'), TREE);
    expect((await result).map(item => item.id)).toEqual(['category-desk']);

    expect(
      await run(loadCategoryChildren('category-lamp'), TREE).result,
    ).toEqual([]);
  });
});
