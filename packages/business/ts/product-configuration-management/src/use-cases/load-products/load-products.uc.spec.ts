import {
  EntityLinkResolverTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityLinkResolver,
  makeInMemoryEntityRepository,
  runRepository,
  runRepositoryExit,
} from '@r10c/entifix-ts-testing-unit';
import { Effect, Exit, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { Product } from '../../entities/product/product.entity.js';
import { ProductBrand } from '../../entities/product-brand/product-brand.entity.js';
import { ProductCategory } from '../../entities/product-category/product-category.entity.js';
import { loadProductsUCFactory } from './load-products.uc.js';

const makeBrand = (id: string, name: string) => {
  const brand = new ProductBrand(name);
  brand.id = id;
  return brand;
};

const makeCategory = (id: string, name: string) => {
  const category = new ProductCategory(id.toUpperCase(), name);
  category.id = id;
  return category;
};

/**
 * A product with both relations populated — embedded when a `brand` instance is
 * given, a foreign key otherwise. Both are always set: the use-case reloads any
 * link that is not already loaded, including one holding no id at all, so a
 * product with an empty relation fails resolution (see the test that pins it).
 */
const makeProduct = (id: string, brand?: ProductBrand, categoryId = 'c-1') => {
  const product = new Product(`code-${id}`, `Product ${id}`);
  product.id = id;
  if (brand) {
    product.brand.setValue(brand);
  } else {
    product.brand.setId('b-1');
  }
  product.category.setId(categoryId);
  return product;
};

const brands = [makeBrand('b-1', 'Acme')];
const categories = [makeCategory('c-1', 'Tools')];

let products: Product[];

const world = () => {
  const repository = makeInMemoryEntityRepository(products);
  const resolver = makeInMemoryEntityLinkResolver([
    [ProductBrand, brands],
    [ProductCategory, categories],
  ]);
  return {
    repository,
    resolver,
    layer: Layer.mergeAll(
      Layer.succeed(EntityRepositoryTag, repository),
      Layer.succeed(EntityLinkResolverTag, resolver),
      Layer.succeed(EntityLoadRequestTag, {}),
    ),
  };
};

beforeEach(() => {
  products = [makeProduct('p-1', undefined, 'c-1')];
});

const runLoad = (layer: ReturnType<typeof world>['layer']) =>
  runRepository(loadProductsUCFactory().pipe(Effect.provide(layer)));

describe('loadProductsUCFactory', () => {
  it('returns the repository page', async () => {
    const page = await runLoad(world().layer);

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  // The point of the use-case: whatever shape the source used, the page it
  // returns always has both relations materialized.
  it('follows a foreign-key link through the resolver', async () => {
    const page = await runLoad(world().layer);

    expect(page.items[0]?.category.isLoaded).toBe(true);
    expect(page.items[0]?.category.value?.name).toBe('Tools');
  });

  it('leaves an already-embedded link alone rather than refetching it', async () => {
    products = [makeProduct('p-1', makeBrand('b-1', 'Embedded'))];
    const { resolver, layer } = world();

    const page = await runLoad(layer);

    expect(page.items[0]?.brand.value?.name).toBe('Embedded');
    expect(resolver.requested.map((entry) => entry.id)).toEqual(['c-1']);
  });

  it('leaves an already-embedded category alone too', async () => {
    const product = makeProduct('p-1', makeBrand('b-1', 'Embedded'));
    product.category.setValue(makeCategory('c-1', 'Embedded category'));
    products = [product];
    const { resolver, layer } = world();

    const page = await runLoad(layer);

    expect(page.items[0]?.category.value?.name).toBe('Embedded category');
    expect(resolver.requested).toEqual([]);
  });

  it('resolves both relations when neither arrived loaded', async () => {
    products = [makeProduct('p-1')];

    const page = await runLoad(world().layer);

    expect(page.items[0]?.brand.value?.name).toBe('Acme');
    expect(page.items[0]?.category.value?.name).toBe('Tools');
  });

  it('resolves relations for every product on the page', async () => {
    products = [makeProduct('p-1', undefined, 'c-1'), makeProduct('p-2', undefined, 'c-1')];

    const page = await runLoad(world().layer);

    expect(page.items.every((product) => product.category.isLoaded)).toBe(true);
  });

  it('does nothing beyond the load for an empty page', async () => {
    products = [];
    const { resolver, layer } = world();

    const page = await runLoad(layer);

    expect(page.items).toEqual([]);
    expect(resolver.requested).toEqual([]);
  });

  it('fails when a link cannot be resolved', async () => {
    products = [makeProduct('p-1', undefined, 'missing')];

    const exit = await runRepositoryExit(
      loadProductsUCFactory().pipe(Effect.provide(world().layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  // The reload is unconditional on `isLoaded`, so a relation the payload left
  // entirely empty is still sent to the resolver — with no id — and fails.
  // Pinned here because it is the behaviour callers actually get today.
  it('fails on a product whose relation carries no id at all', async () => {
    const product = new Product('code-p-1', 'Product p-1');
    product.id = 'p-1';
    products = [product];

    const exit = await runRepositoryExit(
      loadProductsUCFactory().pipe(Effect.provide(world().layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('propagates a repository failure without touching the resolver', async () => {
    const { repository, resolver, layer } = world();
    repository.failNext(new EntifixConnError('unreachable'));

    const exit = await runRepositoryExit(
      loadProductsUCFactory().pipe(Effect.provide(layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(resolver.requested).toEqual([]);
  });
});
