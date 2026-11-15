import { EntityRepositoryFactoryTag } from '@entifix/business';
import { parseLoadRequestParams, serializeSort } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  dictionaryTermApi,
  productBrandApi,
  productCategoryApi,
} from './catalog-reference-api.js';

const brand = (id: string, status: 'active' | 'retired' = 'active') =>
  Object.assign(new ProductBrand(id), { id, status });

const category = (id: string, parentId?: string) =>
  Object.assign(new ProductCategory(id, { es: id, en: id }), {
    id,
    status: 'active' as const,
    ...(parentId === undefined ? {} : { parentId }),
  });

/** One store per entity, seeded. */
const world = (seeds: {
  brands?: ProductBrand[];
  categories?: ProductCategory[];
}) => {
  const brands = makeInMemoryEntityRepository(seeds.brands ?? []);
  const categories = makeInMemoryEntityRepository(seeds.categories ?? []);
  const layer = Layer.succeed(EntityRepositoryFactoryTag, {
    for: entity =>
      Effect.succeed(
        (entity as unknown) === ProductBrand ? brands : categories,
      ),
  });
  return <A, E>(effect: Effect.Effect<A, E, EntityRepositoryFactoryTag>) =>
    Effect.runPromise(Effect.result(effect).pipe(Effect.provide(layer)));
};

const ids = (...values: string[]) => ({
  payload: { selection: { mode: 'ids', ids: values } },
});

const [retireBrands, restoreBrands] = productBrandApi.options.useCases;
const [retireCategories] = productCategoryApi.options.useCases;

describe('the vocabulary declarations', () => {
  it('are read by anyone and written behind the entity’s own permission', () => {
    for (const api of [
      dictionaryTermApi,
      productBrandApi,
      productCategoryApi,
    ]) {
      expect(api.options.guard).toEqual({
        read: { kind: 'public' },
        write: { kind: 'permission' },
      });
    }
    expect(
      productCategoryApi.options.useCases.map(verb => verb.useCase.key),
    ).toEqual(['retire', 'restore']);
  });
});

/**
 * #573: a category's name is localized, and entifix answers a locale path only
 * for a locale the process declared. Importing the declarations declares the
 * fleet's, so the service accepts `name.es` — without it, it knows only `en`.
 */
describe('a localized category name', () => {
  it('is filtered and sorted one locale at a time, in either of the fleet’s', () => {
    for (const locale of ['es', 'en']) {
      const request = parseLoadRequestParams(
        ProductCategory,
        new URLSearchParams({
          rsql: `name.${locale}=like=caf`,
          sort: serializeSort<ProductCategory>([
            {
              0: {
                property: `name.${locale}` as keyof ProductCategory,
                type: 'asc',
              },
            },
          ]),
        }),
      );

      expect(JSON.stringify(request)).toContain(`name.${locale}`);
    }
  });

  it('refuses the bare member', () => {
    expect(() =>
      parseLoadRequestParams(
        ProductCategory,
        new URLSearchParams({
          sort: serializeSort<ProductCategory>([
            { 0: { property: 'name', type: 'asc' } },
          ]),
        }),
      ),
    ).toThrow();
  });
});

describe('retiring and restoring over a selection', () => {
  it('retires what a selection names, reporting per row, and puts it back', async () => {
    const run = world({ brands: [brand('b-1')] });

    const retired = await run(retireBrands.handler(ids('b-1', 'b-9')));
    const restored = await run(restoreBrands.handler(ids('b-1')));

    expect(retired).toMatchObject({
      _tag: 'Success',
      success: {
        meta: { type: 'bulkOutcome', entity: 'product-brand' },
        data: [
          { id: 'b-1', ok: true },
          { id: 'b-9', ok: false, code: 'notFound' },
        ],
      },
    });
    expect(restored).toMatchObject({
      success: { data: [{ id: 'b-1', ok: true }] },
    });
  });

  it('refuses a category with an active child, per row', async () => {
    const run = world({
      categories: [category('root'), category('leaf', 'root')],
    });

    expect(await run(retireCategories.handler(ids('root')))).toMatchObject({
      success: {
        data: [{ id: 'root', ok: false, code: 'categoryHasChildren' }],
      },
    });
  });

  it('refuses a body that is not a selection, rather than defaulting one', async () => {
    const run = world({});

    expect(
      await run(retireBrands.handler({ payload: { selection: 'everything' } })),
    ).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'InvalidBody' },
    });
  });
});

describe('saving a category', () => {
  it('checks the tree as it saves', async () => {
    const run = world({ categories: [category('root')] });
    const prepare = productCategoryApi.options.prepare;

    expect(await run(prepare(category('orphan', 'ghost')))).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'CategoryParentMissing', categoryCode: 'orphan' },
    });
  });
});
