import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Cluster,
  PaginationLinks,
  Stack,
  Text,
} from '@entifix/react-controls/primitives';
import {
  categorySubtree,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import {
  loadBrands,
  loadCategories,
} from '@r10c/implementation-catalog-reference-next';
import {
  offeringFacets,
  SEARCH_PAGE_SIZE,
  SEARCH_SORTS,
  searchHref,
  searchOfferings,
  type SearchSort,
  type SearchState,
} from '@r10c/implementation-marketplace-catalog-next';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { FacetPanel, SortControl } from '@r10c/utils-react-ui';
import { cacheLife } from 'next/cache';

import { CATALOG_CACHE } from './catalog-cache';
import { emptyPage, runRead } from './catalog-reads';
import { OfferingGrid } from './offering-grid';

/** Each order's label in the `storefront.listing.sorts` catalog. */
const SORT_LABEL = {
  'price-asc': 'storefront.listing.sorts.priceAsc',
  'price-desc': 'storefront.listing.sorts.priceDesc',
  newest: 'storefront.listing.sorts.newest',
  name: 'storefront.listing.sorts.name',
} as const satisfies Record<SearchSort, string>;

/**
 * The order a listing takes when the address names none. Paging an unsorted
 * read is not stable, so page 2 could repeat a product from page 1.
 */
const DEFAULT_SORT: SearchSort = 'name';

export interface OfferingListingProps {
  readonly locale: Locale;
  /** The listing's own path, without the locale: every link leads back here. */
  readonly path: string;
  readonly state: SearchState;
  /**
   * A category the page itself stands for. Its whole subtree is matched
   * (ADR 0062), the address does not repeat it, and the panel offers no
   * category facet, because the path already chose one.
   */
  readonly categoryId?: string;
  /** What to say when nothing matched, already translated. */
  readonly emptyLabel: string;
}

/**
 * The search composition: facets, a count, the sort, a page of cards and the
 * page links, all read from one address and all written back as links.
 *
 * Search and every category page render this, so a category is a facet set
 * in advance rather than a second listing (#342). Nothing here runs in the
 * browser: a facet or a sort is a link, the price is a GET form, and the pager
 * is entifix's server `PaginationLinks`.
 *
 * The vocabulary reads (categories, brands, sellers) are what the facets and
 * the category subtree are built from. Each one degrades on its own, so a
 * failed brand read leaves the panel without brands rather than the page
 * without products.
 */
export async function OfferingListing({
  locale,
  path,
  state,
  categoryId,
  emptyLabel,
}: OfferingListingProps) {
  // Keyed by every prop, the parsed search included: one entry per distinct
  // listing, each reused for the catalog's lifetime.
  'use cache';
  cacheLife(CATALOG_CACHE);

  const t = getServerTFor(locale, 'r10c');
  const controls = getServerTFor(locale, 'controls');

  const [categories, brands, vendors] = await Promise.all([
    runRead(ProductCategory, loadCategories(), emptyPage<ProductCategory>()),
    runRead(ProductBrand, loadBrands(), emptyPage<ProductBrand>()),
    runRead(PublishedVendor, loadVendors(), []),
  ]);

  const sort = (state.sort[0] as SearchSort | undefined) ?? DEFAULT_SORT;
  const result = await runRead(
    PublishedOffering,
    searchOfferings(
      {
        ...state,
        sort: [sort],
        category: categoryId === undefined ? state.category : [categoryId],
      },
      // On a failed category read the subtree is the category alone, so the
      // listing degrades to its flat answer rather than to nothing.
      { subtreeOf: id => categorySubtree(categories.items, id) },
    ),
    emptyPage<PublishedOffering>(),
  );

  const href = localeHref(locale, path);
  const current = Number(state.page[0] ?? '1');

  const facets = offeringFacets({
    path: href,
    state,
    choices: {
      // The roots only: the facet matches a whole subtree, and a root's page
      // is where its children are offered.
      ...(categoryId === undefined
        ? {
            category: categories.items
              .filter(category => !category.parentId)
              .map(category => ({
                id: String(category.id),
                name: category.name,
              })),
          }
        : {}),
      brand: brands.items
        .filter(brand => brand.status === 'active')
        .map(brand => ({ id: String(brand.id), name: brand.name })),
      seller: vendors.map(vendor => ({
        id: vendor.vendorId,
        name: vendor.displayName,
      })),
    },
    labels: {
      category: t('storefront.listing.facets.category'),
      brand: t('storefront.listing.facets.brand'),
      seller: t('storefront.listing.facets.seller'),
      price: t('storefront.listing.facets.price'),
      available: t('storefront.listing.facets.available'),
      min: t('storefront.listing.facets.min'),
      max: t('storefront.listing.facets.max'),
      apply: t('storefront.listing.facets.apply'),
    },
  });

  // What the folded panel's summary counts: each facet in force once, the
  // price once whichever bounds it has, and no category on a category page,
  // whose path chose it.
  const activeFilters =
    state.brand.length +
    state.seller.length +
    (categoryId === undefined ? state.category.length : 0) +
    (state.min.length + state.max.length > 0 ? 1 : 0) +
    state.available.length;

  return (
    <div className="grid grid-cols-1 gap-l sm:grid-cols-[14rem_minmax(0,1fr)]">
      <FacetPanel
        label={t('storefront.listing.filters')}
        facets={facets}
        collapsible={{
          summary: t('storefront.listing.filtersSummary', {
            count: activeFilters,
          }),
        }}
      />

      <Stack gap="s">
        <Cluster gap="s" justify="between">
          <Text muted>
            {t('storefront.listing.results', { count: result.total })}
          </Text>
          <SortControl
            label={t('storefront.listing.sort')}
            options={SEARCH_SORTS.map(value => ({
              value,
              label: t(SORT_LABEL[value]),
            }))}
            current={sort}
            hrefFor={value => searchHref(href, state, { sort: [value] })}
          />
        </Cluster>

        <OfferingGrid
          locale={locale}
          offerings={result.items}
          emptyLabel={emptyLabel}
        />

        <PaginationLinks
          currentPage={current}
          pageSize={SEARCH_PAGE_SIZE}
          totalItems={result.total}
          t={controls}
          // Page 1 is the bare address, as the codec writes it.
          hrefFor={target =>
            searchHref(href, state, {
              page: target === 1 ? [] : [String(target)],
            })
          }
        />
      </Stack>
    </div>
  );
}
