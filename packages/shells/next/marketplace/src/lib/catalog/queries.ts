import {
  loadProductsUCFactory,
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import {
  createEntityLinkResolver,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import type {
  Entity,
  EntityLoadRequest,
  EntityPage,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import {
  createFixtureRepositoryContext,
  fixtureConfigurationContext,
} from './fixture-repository';
import {
  BRAND_FIXTURES,
  CATEGORY_FIXTURES,
  PRODUCT_FIXTURES,
} from './fixtures';

/**
 * The storefront's read side.
 *
 * Every function here is the server mirror of what marketplace-admin does in a
 * client page: build a `Context` from adapters, hand it to the *same*
 * use-case, run it. The admin app merges REST adapters; this one merges fixture
 * adapters, and the use-case cannot tell the difference. That is the whole
 * point of the layering — when marketplace-service lands, only the three
 * `createFixtureRepositoryContext` calls below change.
 *
 * `createEntityLinkResolver` sits in `entifix-ts-business`, beside the tag it
 * fills, precisely so a server component can call it without reaching into a
 * React package — `useEntityLinkResolver` is only a `useMemo` around it.
 */

const productRepository = createFixtureRepositoryContext(
  Product,
  PRODUCT_FIXTURES,
);
const brandRepository = createFixtureRepositoryContext(
  ProductBrand,
  BRAND_FIXTURES,
);
const categoryRepository = createFixtureRepositoryContext(
  ProductCategory,
  CATEGORY_FIXTURES,
);

// Link resolution is wired here, at the composition root, out of the same base
// adapters — exactly the seam the admin pages use.
const linkResolver = createEntityLinkResolver(fixtureConfigurationContext, [
  [ProductBrand, brandRepository],
  [ProductCategory, categoryRepository],
]);

function contextFor(
  repository: Context.Context<EntityRepositoryTag>,
  request: EntityLoadRequest<Entity>,
) {
  return Context.merge(
    Context.merge(
      Context.merge(fixtureConfigurationContext, repository),
      linkResolver,
    ),
    Context.make(EntityLoadRequestTag, request),
  );
}

export interface ProductQuery {
  /** A category `code`, as it appears in the URL. */
  readonly category?: string;
  /** Free text, matched against the product name. */
  readonly search?: string;
  readonly sort?: 'name' | 'code';
  readonly direction?: 'asc' | 'desc';
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * The URL carries a category's `code`, never its id — resolving it here keeps
 * the slug out of the repository, which only knows about stored fields.
 */
function categoryIdFor(code: string) {
  return CATEGORY_FIXTURES.find(category => category['code'] === code)?.['id'];
}

function toLoadRequest(query: ProductQuery): EntityLoadRequest<Entity> {
  const filtering = [
    ...(query.category
      ? [
          {
            property: 'category',
            operator: 'eq' as const,
            value: categoryIdFor(query.category),
          },
        ]
      : []),
    ...(query.search
      ? [{ property: 'name', operator: 'like' as const, value: query.search }]
      : []),
  ];

  return {
    filtering: filtering.length > 0 ? (filtering as never) : undefined,
    sorting: query.sort
      ? ([
          { 0: { property: query.sort, type: query.direction ?? 'asc' } },
        ] as never)
      : undefined,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Runs the real `loadProductsUCFactory`, `brand` and `category` resolved. */
export function loadProducts(
  query: ProductQuery = {},
): Promise<EntityPage<Product>> {
  return Effect.runPromise(
    loadProductsUCFactory().pipe(
      Effect.provide(contextFor(productRepository, toLoadRequest(query))),
    ) as Effect.Effect<EntityPage<Product>>,
  );
}

/**
 * One product by its `code`, which is what the URL slug carries.
 *
 * `code` is not `filterable` on `Product`, and that metadata is the server-side
 * allowlist a real service enforces — so this filters in the page rather than
 * inventing a query the backend would reject with a `400`.
 */
export async function getProduct(code: string): Promise<Product | undefined> {
  const page = await loadProducts({ pageSize: PRODUCT_FIXTURES.length });
  return page.items.find(product => product.code === code);
}

/** Every category, for the nav strip and the category routes. */
export function loadCategories(): Promise<EntityPage<ProductCategory>> {
  return Effect.runPromise(
    loadUCFactory<ProductCategory>().pipe(
      Effect.provide(
        contextFor(categoryRepository, {
          sorting: [{ 0: { property: 'name', type: 'asc' } }] as never,
        }),
      ),
    ) as Effect.Effect<EntityPage<ProductCategory>>,
  );
}
