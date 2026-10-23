import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  ButtonLink,
  HeadingOne,
  HeadingTwo,
  Lead,
  Overline,
  Stack,
} from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { loadOfferings } from '@r10c/implementation-marketplace-catalog-next';
import { Suspense } from 'react';

import { emptyPage, runRead } from '../catalog/catalog-reads';
import { OfferingGrid, OfferingGridSkeleton } from '../catalog/offering-grid';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * The storefront's front page. Prerendered, one copy per locale, revalidated on
 * the interval the route declares.
 *
 * The hero is rendered directly and the grid sits behind a `Suspense`, so the
 * first flush already carries the heading — the LCP element — while the catalog
 * query is still resolving. That race is what the boundary is for: the query is
 * now a real request to marketplace-service, not a fixture lookup.
 */
async function FeaturedOfferings({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');
  const page = await runRead(
    PublishedOffering,
    loadOfferings({ pageSize: 6, sort: 'name' }),
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
          <Suspense fallback={<OfferingGridSkeleton />}>
            <FeaturedOfferings locale={locale} />
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
