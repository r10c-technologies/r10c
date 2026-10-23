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
const CATEGORIES = [
  category('category-tableware', 'vajilla', 'Vajilla'),
  category('category-lighting', 'iluminacion', 'Iluminación'),
];

const run = <A>(
  read: Effect.Effect<
    A,
    unknown,
    EntityRepositoryTag
  >,
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
        filtering: [{ property: 'code', operator: 'eq', value: 'vajilla' }],
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
