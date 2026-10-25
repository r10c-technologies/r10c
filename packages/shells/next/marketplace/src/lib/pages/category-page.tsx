import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  HeadingOne,
  Overline,
  Stack,
  Text,
} from '@entifix/react-controls/primitives';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import {
  getCategoryByCode,
  loadCategoryChildren,
  loadCategoryTrail,
} from '@r10c/implementation-catalog-reference-next';
import {
  parseSearch,
  type SearchParams,
} from '@r10c/implementation-marketplace-catalog-next';
import { Breadcrumbs, CategoryNav } from '@r10c/utils-react-ui';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { CATALOG_CACHE } from '../catalog/catalog-cache';
import { catalogCrumbs } from '../catalog/catalog-crumbs';
import { runRead } from '../catalog/catalog-reads';
import { OfferingGridSkeleton } from '../catalog/offering-grid';
import { OfferingListing } from '../catalog/offering-listing';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * A category listing: the search composition with the category set in
 * advance (#342). Facets, sort and paging are carried entirely in the URL,
 * and the server renders the answer.
 *
 * The route reads `searchParams`, so everything below its static shell
 * renders per visit — but cheaply: the code lookup, the heading and each
 * distinct listing are cache entries on the catalog's lifetime.
 */
export interface CategoryPageProps {
  readonly locale: Locale;
  readonly code: string;
  readonly searchParams: SearchParams;
}

/** What the page states about its category, as a cache entry may hold it. */
interface CategoryFound {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/**
 * The category a code names, as plain data, or `undefined` for a code that
 * names none (or a retired one, which leaves browsing with #327).
 */
async function findCategory(code: string): Promise<CategoryFound | undefined> {
  'use cache';
  cacheLife(CATALOG_CACHE);

  // One filtered read rather than the whole vocabulary scanned in the page:
  // `code` is a scalar and therefore `filterable`, which is also the
  // server-side RSQL allowlist marketplace-service checks before it answers.
  const category = await runRead(
    ProductCategory,
    getCategoryByCode(code),
    undefined,
  );
  return category === undefined
    ? undefined
    : {
        id: String(category.id),
        name: category.name,
        ...(category.description ? { description: category.description } : {}),
      };
}

/**
 * The category's trail, heading and children: cached per locale and
 * category, and the same for every filter, sort and page of its listing.
 */
async function CategoryHeading({
  locale,
  category,
}: {
  readonly locale: Locale;
  readonly category: CategoryFound;
}) {
  'use cache';
  cacheLife(CATALOG_CACHE);

  const t = getServerTFor(locale, 'r10c');
  // The trail and the children are one vocabulary read each, and on a failed
  // read the page goes without them rather than without its products.
  const [trail, children] = await Promise.all([
    runRead(ProductCategory, loadCategoryTrail(category.id), []),
    runRead(ProductCategory, loadCategoryChildren(category.id), []),
  ]);

  return (
    <>
      <Breadcrumbs
        label={t('storefront.breadcrumbs.label')}
        items={catalogCrumbs({
          locale,
          home: t('storefront.breadcrumbs.home'),
          trail,
        })}
      />

      <Stack gap="2xs">
        <Overline>{t('storefront.category.overline')}</Overline>
        <HeadingOne>{category.name}</HeadingOne>
        {category.description ? (
          <Text muted>{category.description}</Text>
        ) : null}
      </Stack>

      {/* The level below this one (ADR 0062); the header names the roots. */}
      <CategoryNav
        label={t('storefront.category.children')}
        items={children.map(child => ({
          label: child.name,
          href: localeHref(locale, storePaths.category(child.code)),
        }))}
      />
    </>
  );
}

/**
 * As on the product page, the `404` for an unknown code is the proxy's; the
 * check here covers a category retired since the proxy last asked.
 */
export async function CategoryPage({
  locale,
  code,
  searchParams,
}: CategoryPageProps) {
  const t = getServerTFor(locale, 'r10c');
  const category = await findCategory(code);
  if (!category) notFound();

  // The path names the category, so a `?category=` on it is ignored.
  const state = { ...parseSearch(searchParams), category: [] };

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <CategoryHeading locale={locale} category={category} />

        <Suspense fallback={<OfferingGridSkeleton count={6} />}>
          <OfferingListing
            locale={locale}
            path={storePaths.category(code)}
            state={state}
            categoryId={category.id}
            emptyLabel={t('storefront.category.empty')}
          />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
