import { EntityRepositoryFactoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductBrand } from '../../entities/product-brand/product-brand.entity.js';
import { ProductCategory } from '../../entities/product-category/product-category.entity.js';
import {
  CATEGORY_HAS_CHILDREN,
  CATEGORY_PARENT_MISSING,
  categoryRetireGuard,
} from '../../values/category-tree.js';
import { categorySaveConflict, retireSelection } from './retire-selection.js';

const brand = (id: string) =>
  Object.assign(new ProductBrand(id), { id, status: 'active' as const });

const category = (id: string, parentId?: string) =>
  Object.assign(new ProductCategory(id, id), {
    id,
    status: 'active' as const,
    ...(parentId === undefined ? {} : { parentId }),
  });

/** One repository per entity, seeded, so a run sees the rows it wrote. */
const run = <A, E>(
  effect: Effect.Effect<A, E, EntityRepositoryFactoryTag>,
  seeds: { brands?: ProductBrand[]; categories?: ProductCategory[] } = {},
) => {
  const brands = makeInMemoryEntityRepository(seeds.brands ?? []);
  const categories = makeInMemoryEntityRepository(seeds.categories ?? []);
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.succeed(EntityRepositoryFactoryTag, {
          for: entity =>
            Effect.succeed(
              (entity as unknown) === ProductBrand ? brands : categories,
            ),
        }),
      ),
    ),
  );
};

describe('retireSelection', () => {
  it('retires the ids a selection names', async () => {
    const outcomes = await run(
      retireSelection(ProductBrand, {
        selection: { mode: 'ids', ids: new Set(['b-1']) },
        retired: true,
      }),
      { brands: [brand('b-1'), brand('b-2')] },
    );

    expect(outcomes).toEqual([{ id: 'b-1', ok: true }]);
  });

  it('retires every matching row but the ones it excluded', async () => {
    const outcomes = await run(
      retireSelection(ProductBrand, {
        selection: {
          mode: 'matching',
          total: 3,
          excluded: new Set(['b-2']),
        },
        retired: true,
      }),
      { brands: [brand('b-1'), brand('b-2'), brand('b-3')] },
    );

    expect(outcomes.map(outcome => outcome.id)).toEqual(['b-1', 'b-3']);
  });

  it('asks the store-wide guard per row', async () => {
    const outcomes = await run(
      retireSelection(ProductCategory, {
        selection: { mode: 'ids', ids: new Set(['root']) },
        retired: true,
        guard: categoryRetireGuard,
      }),
      { categories: [category('root'), category('leaf', 'root')] },
    );

    expect(outcomes).toEqual([
      { id: 'root', ok: false, code: CATEGORY_HAS_CHILDREN },
    ]);
  });
});

describe('categorySaveConflict', () => {
  it('names where a category cannot sit, and allows where it can', async () => {
    const seeds = { categories: [category('root')] };

    expect(
      await run(categorySaveConflict(category('leaf', 'root')), seeds),
    ).toBeUndefined();
    expect(
      await run(categorySaveConflict(category('leaf', 'ghost')), seeds),
    ).toBe(CATEGORY_PARENT_MISSING);
  });
});
