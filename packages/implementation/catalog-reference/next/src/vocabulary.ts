import {
  EntityLoadRequestTag,
  type EntityRepositoryTag,
  loadUCFactory,
} from '@entifix/business';
import type {
  EntifixError,
  Entity,
  EntityLoadRequest,
  EntityPage,
} from '@entifix/core';
import type {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { Context, Effect } from 'effect';

/**
 * What every read here requires: **one entity's** repository, and nothing
 * else.
 *
 * Which repository is the caller's to provide, and each function below names
 * the entity whose repository it reads. The cell never chooses the transport:
 * the storefront binds REST, and nothing here would change if it bound
 * something else.
 */
export type VocabularyRead<A> = Effect.Effect<
  A,
  EntifixError,
  EntityRepositoryTag
>;

/**
 * How many brands or categories one read takes.
 *
 * The browse vocabulary is operator-authored and platform-wide — a marketplace
 * has to *merge* it, which is why it is not per vendor — so it is bounded by
 * construction and small. If that ever stops being true the fix is a lookup
 * filtered by id, which needs `id` to become `filterable` on both entities;
 * paging silently here instead would make a brand vanish from the storefront
 * with nothing failing.
 */
export const VOCABULARY_PAGE_SIZE = 200;

/**
 * The generic load use case over whatever repository the caller provided.
 *
 * The cast is the one every read here needs: an `EntityLoadRequest` is
 * parameterized by the entity it filters, and a filter is a member *name*, so
 * two instantiations never overlap structurally even though the value is the
 * same.
 */
const load = <TEntity extends Entity>(
  request: EntityLoadRequest<Entity>,
): VocabularyRead<EntityPage<TEntity>> =>
  loadUCFactory<TEntity>().pipe(
    Effect.provide(Context.make(EntityLoadRequestTag, request)),
  ) as VocabularyRead<EntityPage<TEntity>>;

const BY_NAME = [{ 0: { property: 'name', type: 'asc' } }] as never;

/**
 * Only what is still offered for classification.
 *
 * ⚠️ **Retired is filtered where a buyer would browse into it, and nowhere
 * else** (#327). A retired category must leave the nav strip and its `/c/` route,
 * but an offering classified under it before it was retired still names it,
 * and retiring exists precisely so that reference keeps resolving
 * (`reference-status.ts`). So the readers that *name* an offering's reference
 * ({@link loadBrands}, {@link getBrand}, {@link getCategory}) read the whole
 * vocabulary, and only the browse readers narrow it.
 */
const ACTIVE = { property: 'status', operator: 'eq', value: 'active' } as const;

/** Every active category, for the nav strip. Reads `ProductCategory`. */
export const loadCategories = (): VocabularyRead<EntityPage<ProductCategory>> =>
  load<ProductCategory>({
    filtering: [ACTIVE] as never,
    sorting: BY_NAME,
    pageSize: VOCABULARY_PAGE_SIZE,
  });

/** Every category, retired ones included, for naming what an offering points at. */
const loadEveryCategory = (): VocabularyRead<EntityPage<ProductCategory>> =>
  load<ProductCategory>({
    sorting: BY_NAME,
    pageSize: VOCABULARY_PAGE_SIZE,
  });

/**
 * Every brand, retired ones included, so a grid can name each offering's
 * without a request per card. Reads `ProductBrand`.
 */
export const loadBrands = (): VocabularyRead<EntityPage<ProductBrand>> =>
  load<ProductBrand>({
    sorting: BY_NAME,
    pageSize: VOCABULARY_PAGE_SIZE,
  });

/**
 * The active category a URL slug names, or `undefined` for a retired one, so
 * its route 404s. Reads `ProductCategory`.
 *
 * `code` is `filterable` — a scalar member inherits both flags, which is also
 * the server-side RSQL allowlist — so this is one filtered read rather than the
 * whole vocabulary scanned in the page.
 */
export const getCategoryByCode = (
  code: string,
): VocabularyRead<ProductCategory | undefined> =>
  load<ProductCategory>({
    filtering: [
      { property: 'code', operator: 'eq', value: code },
      ACTIVE,
    ] as never,
    pageSize: 1,
  }).pipe(Effect.map(page => page.items[0]));

/**
 * A brand by id, or `undefined` when an offering names one that no longer
 * exists. Reads `ProductBrand`.
 *
 * ⚠️ Resolved out of the loaded vocabulary rather than with `repository.get`:
 * `id` is the one member that is neither `sortable` nor `filterable` by
 * default, so it cannot be queried — and `get` answers an absent row with
 * `EntifixConnError`, the same class a driver failure raises, so a dangling
 * reference and an outage would be one code path. `brandId` points into
 * another slice's store and nothing enforces it, so a miss is a display gap the
 * caller renders a fallback for.
 */
export const getBrand = (
  id: string | undefined,
): VocabularyRead<ProductBrand | undefined> =>
  id === undefined
    ? Effect.succeed(undefined)
    : loadBrands().pipe(
        Effect.map(page => page.items.find(brand => String(brand.id) === id)),
      );

/** A category by id. Same shape and same caveats as {@link getBrand}. Reads `ProductCategory`. */
export const getCategory = (
  id: string | undefined,
): VocabularyRead<ProductCategory | undefined> =>
  id === undefined
    ? Effect.succeed(undefined)
    : loadEveryCategory().pipe(
        Effect.map(page =>
          page.items.find(category => String(category.id) === id),
        ),
      );
