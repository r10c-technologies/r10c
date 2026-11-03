import { EntityRepositoryTag } from '@entifix/business';
import {
  ancestorsOf,
  type EntifixFailure,
  type Entity,
  type EntityFilter,
  type EntityLoadRequest,
  type EntityPage,
  type EntitySorting,
} from '@entifix/core';
import {
  CATEGORY_KEYS,
  categorySubtree,
  type ProductBrand,
  type ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { Effect } from 'effect';

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
  EntifixFailure,
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
 * One entity's read, straight through the repository the caller provided.
 *
 * Not through the load use case: its request tag carries no entity type, so
 * every filter and sort here would need a cast that the typed
 * `repository.load<TEntity>` does not — the same reason `offerings.ts` reads
 * this way.
 */
const load = <TEntity extends Entity>(
  request: EntityLoadRequest<TEntity>,
): VocabularyRead<EntityPage<TEntity>> =>
  Effect.gen(function* () {
    const repository = yield* EntityRepositoryTag;
    return yield* repository.load<TEntity>(request);
  });

/** Both vocabularies list by name. */
const byName = <TEntity extends ProductBrand | ProductCategory>(): Array<
  EntitySorting<TEntity>
> => [{ 0: { property: 'name', type: 'asc' } }];

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
const ACTIVE: EntityFilter<ProductCategory> = {
  property: 'status',
  operator: 'eq',
  value: 'active',
};

/** Every active category, for the nav strip. Reads `ProductCategory`. */
export const loadCategories = (): VocabularyRead<EntityPage<ProductCategory>> =>
  load<ProductCategory>({
    filtering: [ACTIVE],
    sorting: byName(),
    pageSize: VOCABULARY_PAGE_SIZE,
  });

/**
 * The top of the tree, for the nav strip: every active category with no parent
 * (ADR 0062). A child's offerings are reached through its root, because a
 * category page lists its whole subtree. Reads `ProductCategory`.
 */
export const loadCategoryRoots = (): VocabularyRead<ProductCategory[]> =>
  loadCategories().pipe(
    Effect.map(page =>
      page.items.filter(
        category => category.parentId === undefined || category.parentId === '',
      ),
    ),
  );

/**
 * A category and every active category under it, as ids: what a category page
 * hands the offering read as `categoryIds`. Built from the one vocabulary read
 * rather than a recursive query, because the vocabulary is small and bounded.
 * Reads `ProductCategory`.
 */
export const loadCategorySubtree = (id: string): VocabularyRead<string[]> =>
  loadCategories().pipe(Effect.map(page => categorySubtree(page.items, id)));

/** Every category, retired ones included, for naming what an offering points at. */
const loadEveryCategory = (): VocabularyRead<EntityPage<ProductCategory>> =>
  load<ProductCategory>({
    sorting: byName(),
    pageSize: VOCABULARY_PAGE_SIZE,
  });

/**
 * A category and its ancestors, root first: the breadcrumb trail (ADR 0062).
 * Empty for an id that names no category. Reads `ProductCategory`.
 *
 * Read over every category, retired ones included. A product classified
 * before its category was retired still names that category, and the trail
 * should name it too, as the product page's other references do.
 */
export const loadCategoryTrail = (
  id: string | undefined,
): VocabularyRead<ProductCategory[]> =>
  id === undefined
    ? Effect.succeed([])
    : loadEveryCategory().pipe(
        Effect.map(page => {
          const self = page.items.find(item => CATEGORY_KEYS.idOf(item) === id);
          return self === undefined
            ? []
            : [...ancestorsOf(page.items, CATEGORY_KEYS, id), self];
        }),
      );

/**
 * A category's active children, by name: what its page offers to narrow
 * into. Empty for a leaf. Reads `ProductCategory`.
 */
export const loadCategoryChildren = (
  id: string,
): VocabularyRead<ProductCategory[]> =>
  loadCategories().pipe(
    Effect.map(page =>
      page.items.filter(item => CATEGORY_KEYS.parentOf(item) === id),
    ),
  );

/**
 * Every brand, retired ones included, so a grid can name each offering's
 * without a request per card. Reads `ProductBrand`.
 */
export const loadBrands = (): VocabularyRead<EntityPage<ProductBrand>> =>
  load<ProductBrand>({
    sorting: byName(),
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
    filtering: [{ property: 'code', operator: 'eq', value: code }, ACTIVE],
    pageSize: 1,
  }).pipe(Effect.map(page => page.items[0]));

/**
 * A brand by id, or `undefined` when an offering names one that no longer
 * exists. Reads `ProductBrand`.
 *
 * ⚠️ Resolved out of the loaded vocabulary rather than with `repository.get`:
 * `id` is the one member that is neither `sortable` nor `filterable` by
 * default, so it cannot be queried — and resolving it here keeps a dangling
 * reference a display gap rather than a failure beside an outage's. `brandId` points into
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
