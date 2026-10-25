import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Grid,
  HeadingOne,
  HeadingTwo,
  Lead,
  Overline,
  Stack,
  Text,
} from '@entifix/react-controls/primitives';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { loadCategoryRoots } from '@r10c/implementation-catalog-reference-next';
import {
  loadOfferings,
  type OfferingQuery,
} from '@r10c/implementation-marketplace-catalog-next';
import { cacheLife } from 'next/cache';
import { Suspense } from 'react';

import { CATALOG_CACHE } from '../catalog/catalog-cache';
import { emptyPage, runRead } from '../catalog/catalog-reads';
import { OfferingGrid, OfferingGridSkeleton } from '../catalog/offering-grid';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/** How many cards each strip on the home page shows. */
const STRIP_SIZE = 4;

/**
 * The storefront's front page: a static shell per locale (the hero, the
 * headings, the skeletons) with each section's reads streamed into it.
 *
 * Each section is a cached component behind its own `Suspense`, on the
 * catalog's lifetime (`CATALOG_CACHE`), so the first flush already carries
 * the heading — the LCP element — and a slow strip holds back nothing but
 * itself.
 *
 * Three sections, each one read: the top of the category tree as tiles, the
 * newest publications, and a featured strip. "Featured" is in stock and by
 * name until merchandising has a member of its own to read; the projection
 * holds no editorial choice yet, and inventing one here would be a second
 * source of truth.
 */
async function OfferingStrip({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: OfferingQuery;
}) {
  'use cache';
  cacheLife(CATALOG_CACHE);

  const t = getServerTFor(locale, 'r10c');
  const page = await runRead(
    PublishedOffering,
    loadOfferings({ ...query, pageSize: STRIP_SIZE }),
    emptyPage<PublishedOffering>(),
  );

  return (
    <OfferingGrid
      locale={locale}
      offerings={page.items}
      emptyLabel={t('storefront.category.empty')}
    />
  );
}

/** The roots of the category tree (ADR 0062), one tile each. */
async function CategoryTiles({ locale }: { readonly locale: Locale }) {
  'use cache';
  cacheLife(CATALOG_CACHE);

  const roots = await runRead(ProductCategory, loadCategoryRoots(), []);
  if (roots.length === 0) return null;

  return (
    <Grid min="12rem" gap="s" as="ul" className="list-none p-0">
      {roots.map(category => (
        <li key={category.code}>
          <a
            href={localeHref(locale, storePaths.category(category.code))}
            className="flex h-full flex-col gap-3xs rounded-xl border border-border bg-surface-elevated p-s hover:border-primary"
          >
            <Text weight="semibold">{category.name}</Text>
            {category.description ? (
              <Text muted className="line-clamp-2">
                {category.description}
              </Text>
            ) : null}
          </a>
        </li>
      ))}
    </Grid>
  );
}

export function HomePage({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'r10c');

  return (
    <StoreShell locale={locale}>
      <Stack gap="xl">
        <Stack gap="2xs">
          <Overline>{t('storefront.home.overline')}</Overline>
          <HeadingOne>{t('storefront.home.heading')}</HeadingOne>
          <Lead>{t('storefront.home.lead')}</Lead>
        </Stack>

        <section aria-label={t('storefront.home.categories')}>
          <Stack gap="s">
            <HeadingTwo>{t('storefront.home.categories')}</HeadingTwo>
            <Suspense fallback={null}>
              <CategoryTiles locale={locale} />
            </Suspense>
          </Stack>
        </section>

        <section aria-label={t('storefront.home.newest')}>
          <Stack gap="s">
            <HeadingTwo>{t('storefront.home.newest')}</HeadingTwo>
            <Suspense fallback={<OfferingGridSkeleton count={STRIP_SIZE} />}>
              <OfferingStrip
                locale={locale}
                query={{ sort: 'publishedAt', direction: 'desc' }}
              />
            </Suspense>
          </Stack>
        </section>

        <section aria-label={t('storefront.home.featured')}>
          <Stack gap="s">
            <HeadingTwo>{t('storefront.home.featured')}</HeadingTwo>
            <Suspense fallback={<OfferingGridSkeleton count={STRIP_SIZE} />}>
              <OfferingStrip
                locale={locale}
                query={{ sort: 'name', availableOnly: true }}
              />
            </Suspense>
          </Stack>
        </section>
      </Stack>
    </StoreShell>
  );
}
