import {
  Cluster,
  HeadingOne,
  Overline,
  Stack,
  Text,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import { type Locale } from '@r10c/entifix-ts-i18n/routing';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ProductGrid, ProductGridSkeleton } from '../catalog/product-grid';
import { loadCategories, loadProducts } from '../catalog/queries';
import { storePaths } from '../routing/paths';
import { StoreLink } from '../routing/store-link';
import { StoreShell } from './store-shell';

/**
 * A category listing, with sort and paging carried entirely in the URL.
 *
 * No client state and no client fetching: a sort control is a link, a page
 * control is a link, and the server renders the answer. That is what makes the
 * unfiltered case prerenderable — the moment a page reads `searchParams` Next
 * marks the route dynamic, so the plain `/c/lighting` is served from the static
 * copy and only a sorted or paged URL costs a render.
 */
const PAGE_SIZE = 6;

export interface CategoryPageProps {
  readonly locale: Locale;
  readonly code: string;
  readonly sort?: string;
  readonly page?: string;
}

async function CategoryProducts({
  locale,
  code,
  sort,
  page,
}: CategoryPageProps) {
  const t = getServerTFor(locale, 'shell');
  const current = Math.max(1, Number(page) || 1);
  const result = await loadProducts({
    category: code,
    sort: sort === 'code' ? 'code' : 'name',
    page: current,
    pageSize: PAGE_SIZE,
  });

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const href = (target: number) =>
    `${storePaths.category(code)}?page=${target}${sort ? `&sort=${sort}` : ''}`;

  return (
    <Stack gap="s">
      <Text muted>
        {t('storefront.category.results', { count: result.total })}
      </Text>

      <ProductGrid
        locale={locale}
        products={result.items}
        emptyLabel={t('storefront.category.empty')}
      />

      {pages > 1 ? (
        <Cluster gap="s" justify="between">
          {current > 1 ? (
            <StoreLink locale={locale} href={href(current - 1)}>
              <Text muted>{t('storefront.category.previous')}</Text>
            </StoreLink>
          ) : (
            <span />
          )}
          <Text muted>
            {t('storefront.category.pageOf', { page: current, pages })}
          </Text>
          {current < pages ? (
            <StoreLink locale={locale} href={href(current + 1)}>
              <Text muted>{t('storefront.category.next')}</Text>
            </StoreLink>
          ) : (
            <span />
          )}
        </Cluster>
      ) : null}
    </Stack>
  );
}

export async function CategoryPage(props: CategoryPageProps) {
  const { locale, code, sort } = props;
  const t = getServerTFor(locale, 'shell');

  const categories = await loadCategories();
  const category = categories.items.find(entry => entry.code === code);
  if (!category) notFound();

  const sortHref = (target: 'name' | 'code') =>
    `${storePaths.category(code)}?sort=${target}`;

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <Stack gap="2xs">
          <Overline>{t('storefront.category.overline')}</Overline>
          <HeadingOne>{category.name}</HeadingOne>
          {category.description ? (
            <Text muted>{category.description}</Text>
          ) : null}
        </Stack>

        <Cluster gap="s">
          <Text muted>{t('storefront.category.sort')}</Text>
          <StoreLink locale={locale} href={sortHref('name')}>
            <Text
              muted={sort === 'code'}
              weight={sort === 'code' ? undefined : 'semibold'}
            >
              {t('storefront.category.sortByName')}
            </Text>
          </StoreLink>
          <StoreLink locale={locale} href={sortHref('code')}>
            <Text
              muted={sort !== 'code'}
              weight={sort === 'code' ? 'semibold' : undefined}
            >
              {t('storefront.category.sortByCode')}
            </Text>
          </StoreLink>
        </Cluster>

        <Suspense fallback={<ProductGridSkeleton count={PAGE_SIZE} />}>
          <CategoryProducts {...props} />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
