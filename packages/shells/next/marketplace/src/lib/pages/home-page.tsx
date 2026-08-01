import {
  ButtonLink,
  HeadingOne,
  HeadingTwo,
  Lead,
  Overline,
  Stack,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import { type Locale, localeHref } from '@r10c/entifix-ts-i18n/routing';
import { Suspense } from 'react';

import { ProductGrid, ProductGridSkeleton } from '../catalog/product-grid';
import { loadProducts } from '../catalog/queries';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * The storefront's front page. Fully prerendered, one copy per locale.
 *
 * The hero is rendered directly and the grid sits behind a `Suspense`, so the
 * first flush already carries the heading — the LCP element — while the product
 * query is still resolving. With fixtures that race is over instantly; with a
 * real backend it is the difference between a blank screen and a page.
 */
async function FeaturedProducts({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');
  const page = await loadProducts({ pageSize: 6, sort: 'name' });

  return (
    <ProductGrid
      locale={locale}
      products={page.items}
      emptyLabel={t('storefront.category.empty')}
    />
  );
}

export function HomePage({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <Stack gap="2xs">
          <Overline>{t('storefront.home.overline')}</Overline>
          <HeadingOne>{t('storefront.home.heading')}</HeadingOne>
          <Lead>{t('storefront.home.lead')}</Lead>
        </Stack>

        <Stack gap="s">
          <HeadingTwo>{t('storefront.home.featured')}</HeadingTwo>
          <Suspense fallback={<ProductGridSkeleton />}>
            <FeaturedProducts locale={locale} />
          </Suspense>
        </Stack>

        <div>
          <ButtonLink href={localeHref(locale, storePaths.search())}>
            {t('storefront.search.heading')}
          </ButtonLink>
        </div>
      </Stack>
    </StoreShell>
  );
}
