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
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

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
 * ⚠️ **Every visit renders, the plain `/c/lighting` included.** The route reads
 * `searchParams`, and that alone makes it dynamic in Next, so there is no
 * static copy of the unfiltered listing. A static shell with the results
 * streamed is #346's work (partial prerendering).
 */
export interface CategoryPageProps {
  readonly locale: Locale;
  readonly code: string;
  readonly searchParams: SearchParams;
}

export async function CategoryPage({
  locale,
  code,
  searchParams,
}: CategoryPageProps) {
  const t = getServerTFor(locale, 'r10c');

  // One filtered read rather than the whole vocabulary scanned in the page:
  // `code` is a scalar and therefore `filterable`, which is also the
  // server-side RSQL allowlist marketplace-service checks before it answers.
  const category = await runRead(
    ProductCategory,
    getCategoryByCode(code),
    undefined,
  );
  if (!category) notFound();

  // The trail and the children are one vocabulary read each, and on a failed
  // read the page goes without them rather than without its products.
  const id = String(category.id);
  const [trail, children] = await Promise.all([
    runRead(ProductCategory, loadCategoryTrail(id), []),
    runRead(ProductCategory, loadCategoryChildren(id), []),
  ]);

  // The path names the category, so a `?category=` on it is ignored.
  const state = { ...parseSearch(searchParams), category: [] };

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
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

        <Suspense fallback={<OfferingGridSkeleton count={6} />}>
          <OfferingListing
            locale={locale}
            path={storePaths.category(code)}
            state={state}
            categoryId={id}
            emptyLabel={t('storefront.category.empty')}
          />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
