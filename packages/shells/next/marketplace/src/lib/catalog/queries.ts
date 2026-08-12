import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
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
  ProductSpecification,
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

function contextFor(
  repository: Context.Context<EntityRepositoryTag>,
  request: EntityLoadRequest<Entity>,
) {
  return Context.merge(
    Context.merge(fixtureConfigurationContext, repository),
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
            property: 'categoryId',
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

/**
 * Runs the real generic load use-case.
 *
 * It used to run `loadProductsUCFactory`, which existed only to resolve a
 * specification's `brand` and `category` links at the storage layer. Those are
 * plain ids now — the targets moved to another slice's store, and a typed link
 * across that boundary is neither legal nor desirable (ADR 0022) — so the
 * bespoke use-case had nothing left to do and was deleted rather than kept as a
 * passthrough.
 */
export function loadProducts(
  query: ProductQuery = {},
): Promise<EntityPage<ProductSpecification>> {
  return Effect.runPromise(
    loadUCFactory<ProductSpecification>().pipe(
      Effect.provide(contextFor(productRepository, toLoadRequest(query))),
    ) as Effect.Effect<EntityPage<ProductSpecification>>,
  );
}

/**
 * One product by its `code`, which is what the URL slug carries.
 *
 * `code` is not `filterable` on `ProductSpecification`, and that metadata is the server-side
 * allowlist a real service enforces — so this filters in the page rather than
 * inventing a query the backend would reject with a `400`.
 */
export async function getProduct(
  code: string,
): Promise<ProductSpecification | undefined> {
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

/**
 * A brand by id, or `undefined` when the specification names one that no longer
 * exists.
 *
 * This is what replaced link resolution. `brandId` points into
 * `catalog-reference` — a platform-plane store owned by another slice — so the
 * name is fetched through that domain's own read path rather than joined at the
 * storage layer (ADR 0022). No foreign key enforces the reference, which is why
 * a miss is `undefined` and the caller renders a fallback rather than failing.
 */
export async function getBrand(
  id: string | undefined,
): Promise<ProductBrand | undefined> {
  if (id === undefined) return undefined;
  const page = await Effect.runPromise(
    loadUCFactory<ProductBrand>().pipe(
      Effect.provide(contextFor(brandRepository, {})),
    ) as Effect.Effect<EntityPage<ProductBrand>>,
  );
  return page.items.find(brand => String(brand.id) === id);
}

/** A category by id. Same shape and same caveats as {@link getBrand}. */
export async function getCategory(
  id: string | undefined,
): Promise<ProductCategory | undefined> {
  if (id === undefined) return undefined;
  const page = await Effect.runPromise(
    loadUCFactory<ProductCategory>().pipe(
      Effect.provide(contextFor(categoryRepository, {})),
    ) as Effect.Effect<EntityPage<ProductCategory>>,
  );
  return page.items.find(category => String(category.id) === id);
}
